import { access, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
};

const projectRoot = resolve(valueAfter("--project-root") || ".");
const videoDir = resolve(valueAfter("--video") || ".");
const packagePath = resolve(videoDir, "package.json");
const checkerPath = resolve(projectRoot, "scripts", "check-video-release.mjs");

function inside(parent, child) {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

if (!inside(projectRoot, videoDir)) {
  console.error("RELEASE HOOK BLOCKED: 视频目录不在项目根目录内");
  process.exit(1);
}

try {
  await access(packagePath);
  await access(checkerPath);
} catch {
  console.error("RELEASE HOOK BLOCKED: 缺少视频 package.json 或项目共享检查入口");
  process.exit(1);
}

let pkg;
try {
  pkg = JSON.parse(await readFile(packagePath, "utf8"));
} catch {
  console.error("RELEASE HOOK BLOCKED: 视频 package.json 不是有效 JSON");
  process.exit(1);
}

pkg.scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
if (!pkg.scripts.publish) {
  console.error("RELEASE HOOK BLOCKED: 视频工程没有 publish 脚本");
  process.exit(1);
}

let checkerRelative = relative(videoDir, checkerPath).replaceAll("\\", "/");
if (!checkerRelative.startsWith(".")) checkerRelative = `./${checkerRelative}`;
const expected = `node "${checkerRelative}" --video .`;
const current = pkg.scripts.prepublish;

if (current && current !== expected) {
  console.error(`RELEASE HOOK BLOCKED: 已存在不同的 prepublish，未覆盖：${current}`);
  process.exit(1);
}

if (current === expected) {
  console.log(`RELEASE HOOK READY: ${videoDir}`);
  process.exit(0);
}

pkg.scripts.prepublish = expected;
const temporary = resolve(dirname(packagePath), ".package.json.release-hook.tmp");
await writeFile(temporary, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
await rename(temporary, packagePath);
console.log(`RELEASE HOOK INSTALLED: ${videoDir}`);
