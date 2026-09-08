import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, resolve, sep } from "node:path";

const zones = JSON.parse(await readFile(new URL("../references/douyin-1080x1920-safe-zones.json", import.meta.url), "utf8"));
const CORE = Object.freeze({
  xMin: zones.core.x,
  xMax: zones.core.x + zones.core.width,
  yMin: zones.core.y,
  yMax: zones.core.y + zones.core.height,
});
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const args = process.argv.slice(2);
const videoIndex = args.indexOf("--video");
const videoArg = videoIndex >= 0 ? args[videoIndex + 1] : ".";
const videoDir = resolve(videoArg || ".");
const failures = [];

function fail(message) {
  failures.push(message);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function requiredText(name) {
  const path = resolve(videoDir, name);
  if (!(await exists(path))) {
    fail(`缺少 ${name}`);
    return "";
  }
  return readFile(path, "utf8");
}

function markdownSection(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^##\\s+${escaped}\\s*$`, "m").exec(text);
  if (!match) return "";
  const remainder = text.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^##\\s+/m);
  return nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder;
}

function field(section, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = section.match(new RegExp(`^-\\s*${escaped}[：:]\\s*(.+?)\\s*$`, "m"))?.[1] ?? "";
  return value.replaceAll("`", "").trim();
}

function containsKey(value, forbidden) {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, forbidden)) return true;
  return Object.values(value).some((child) => containsKey(child, forbidden));
}

async function localFile(relativePath, label, allowedExtensions) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    fail(`${label}路径未填写`);
    return null;
  }
  if (isAbsolute(relativePath)) {
    fail(`${label}必须使用视频目录内的相对路径`);
    return null;
  }

  const candidate = resolve(videoDir, relativePath);
  if (candidate !== videoDir && !candidate.startsWith(`${videoDir}${sep}`)) {
    fail(`${label}路径逃逸出视频目录`);
    return null;
  }
  if (!(await exists(candidate))) {
    fail(`${label}文件不存在：${relativePath}`);
    return null;
  }

  const [videoReal, candidateReal] = await Promise.all([realpath(videoDir), realpath(candidate)]);
  if (candidateReal !== videoReal && !candidateReal.startsWith(`${videoReal}${sep}`)) {
    fail(`${label}实际文件位于视频目录外`);
    return null;
  }

  if (allowedExtensions && !allowedExtensions.has(extname(candidate).toLowerCase())) {
    fail(`${label}文件类型不符合要求：${relativePath}`);
    return null;
  }
  return candidate;
}

async function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function verifyArtifact(artifact, label, extensions) {
  const path = await localFile(artifact?.path, label, extensions);
  const expected = typeof artifact?.sha256 === "string" ? artifact.sha256.toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    fail(`${label} SHA-256 无效或未填写`);
    return;
  }
  if (!path) return;
  const actual = await sha256(path);
  if (actual !== expected) fail(`${label} SHA-256 与当前文件不一致`);
}

const publish = await requiredText("PUBLISH.md");
const prePublish = markdownSection(publish, "发布前内容门禁");
if (!prePublish) fail("PUBLISH.md 缺少“发布前内容门禁”章节");

for (const [label, expected] of [
  ["总结论", "PASS"],
  ["门禁状态", "PASS"],
  ["平台 UI 统一区域", "PASS"],
  ["最终封面裁切与主页缩略图", "PASS"],
  ["机器证据文件", "release-evidence.json"],
]) {
  const actual = field(prePublish, label);
  if (actual !== expected) fail(`PUBLISH.md ${label}不是 ${expected}（当前：${actual || "未填写"}）`);
}

if (/PENDING|待填写|待确认/.test(prePublish)) {
  fail("PUBLISH.md 发布前内容门禁仍有 PENDING、待填写或待确认项");
}

const evidencePath = resolve(videoDir, "release-evidence.json");
let evidence = null;
if (!(await exists(evidencePath))) {
  fail("缺少 release-evidence.json");
} else {
  try {
    evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch {
    fail("release-evidence.json 不是有效 JSON");
  }
}

if (evidence) {
  if (evidence.schemaVersion !== 1) fail("release-evidence.json schemaVersion 必须为 1");
  if (evidence.platform !== "douyin") fail("release-evidence.json platform 必须为 douyin");
  if (!evidence.checkedAt || Number.isNaN(Date.parse(evidence.checkedAt))) fail("release-evidence.json checkedAt 无效或未填写");
  if (evidence.canvas?.width !== zones.canvas.width || evidence.canvas?.height !== zones.canvas.height) fail("发布证据画布必须为 1080×1920");
  if (containsKey(evidence, "safeZones")) fail("项目证据不得复制或覆盖共享 safeZones 坐标");

  await verifyArtifact(evidence.artifacts?.video, "最终候选成片", new Set([".mp4"]));
  await verifyArtifact(evidence.artifacts?.cover, "最终候选封面", IMAGE_EXTENSIONS);

  const overlays = evidence.evidence?.playbackOverlay;
  if (!Array.isArray(overlays) || overlays.length === 0) {
    fail("缺少最终成片的平台 UI 叠层证据");
  } else {
    for (let index = 0; index < overlays.length; index += 1) {
      await localFile(overlays[index], `播放页叠层证据 ${index + 1}`, IMAGE_EXTENSIONS);
    }
  }
  await localFile(evidence.evidence?.coverCrop3x4, "3:4 封面裁切证据", IMAGE_EXTENSIONS);
  await localFile(evidence.evidence?.homeThumbnail, "主页缩略图证据", IMAGE_EXTENSIONS);

  for (const key of ["top", "right", "lower", "coverCrop3x4", "homeThumbnail"]) {
    if (evidence.review?.[key] !== "PASS") fail(`人工复核 ${key} 不是 PASS（当前：${evidence.review?.[key] ?? "未填写"}）`);
  }

  const elements = evidence.criticalElements;
  if (!Array.isArray(elements) || elements.length === 0) {
    fail("release-evidence.json 缺少 criticalElements");
  } else {
    for (const element of elements) {
      const id = typeof element?.id === "string" && element.id ? element.id : "未命名";
      const values = [element?.x, element?.y, element?.width, element?.height];
      if (!values.every(Number.isFinite) || element.width <= 0 || element.height <= 0) {
        fail(`关键元素 ${id} 缺少有效边界`);
        continue;
      }
      const right = element.x + element.width;
      const bottom = element.y + element.height;
      if (element.x < CORE.xMin || right > CORE.xMax || element.y < CORE.yMin || bottom > CORE.yMax) {
        fail(`关键元素 ${id} 超出共享核心安全区`);
      }
    }
  }
}

if (failures.length) {
  console.error(`RELEASE BLOCKED: ${videoDir}`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`RELEASE PASS: ${videoDir}`);
