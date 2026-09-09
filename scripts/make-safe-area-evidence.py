from __future__ import annotations

import argparse
import json
import hashlib
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageChops


SKILL_DIR = Path(__file__).resolve().parent.parent
ZONES_PATH = SKILL_DIR / "references" / "douyin-1080x1920-safe-zones.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate evidence-only Douyin playback, 3:4 crop, and home-thumbnail previews."
    )
    parser.add_argument("--frame", action="append", required=True, help="Actual 1080x1920 representative frame; repeat as needed.")
    parser.add_argument("--cover", required=True, help="Actual delivered 1080x1920 or 1080x1440 cover.")
    parser.add_argument("--cover-source", help="Optional 1080x1920 source: verify delivered 3:4 cover is its central crop.")
    parser.add_argument("--publish", help="Current publishing-material document, as named by project rules.")
    parser.add_argument("--template", help="Project publishing template; paired with --publish.")
    parser.add_argument("--layout-report", help="Actual timeline layout-report.json; BLOCK/INCOMPLETE cannot be cleared here.")
    parser.add_argument("--out-dir", required=True, help="Directory for deterministic QA evidence files.")
    return parser.parse_args()


def fingerprint(path: Path) -> dict:
    return {"path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def publication_fields(text: str) -> dict[str, str]:
    section = re.search(r"^## 发布资料\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not section:
        return {}
    pairs = re.findall(r"^- ([^：\n]+)：[ \t]*([^\n]*(?:\n(?!- |## )[^\n]+)*)", section[1], re.M)
    return {key.strip(): value.strip() for key, value in pairs}


def check_materials(publish: Path, template: Path) -> list[str]:
    if not publish.is_file():
        return ["PUBLISH_MISSING: " + str(publish)]
    required = publication_fields(template.read_text(encoding="utf-8-sig"))
    actual = publication_fields(publish.read_text(encoding="utf-8-sig"))
    if not required:
        return ["TEMPLATE_UNSUPPORTED: expected 发布资料 section"]
    issues = []
    for field in required:
        if "可选" in field:
            continue
        # Parenthesized text in a template label is author guidance, not part of the field name.
        lookup = re.sub(r"（[^）]+）$", "", field).strip()
        value = actual.get(field, actual.get(lookup, "")).strip().strip('`').strip()
        if not value or re.fullmatch(r"待.*|TODO.*|TBD.*|[—\-…]+|<.*>|\{.*\}", value, re.I):
            issues.append("PUBLISH_FIELD_MISSING: " + field)
    return issues


def load_image(path: Path, expected: tuple[int, int], label: str) -> Image.Image:
    if not path.is_file():
        raise SystemExit(f"{label} not found: {path}")
    with Image.open(path) as source:
        image = source.convert("RGBA")
    if image.size != expected:
        raise SystemExit(f"{label} must be {expected[0]}x{expected[1]}, got {image.width}x{image.height}: {path}")
    return image


def rect(box: dict[str, int]) -> tuple[int, int, int, int]:
    return (box["x"], box["y"], box["x"] + box["width"], box["y"] + box["height"])


def shade(image: Image.Image, box: dict[str, int], label: str) -> None:
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    bounds = rect(box)
    draw.rectangle(bounds, fill=(220, 38, 38, 72), outline=(255, 80, 80, 230), width=5)
    draw.rectangle((bounds[0] + 8, bounds[1] + 8, bounds[0] + 20 + 8 * len(label), bounds[1] + 38), fill=(110, 0, 0, 220))
    draw.text((bounds[0] + 14, bounds[1] + 13), label, fill=(255, 255, 255, 255))
    image.alpha_composite(layer)


def main() -> None:
    args = parse_args()
    zones = json.loads(ZONES_PATH.read_text(encoding="utf-8"))
    canvas = (zones["canvas"]["width"], zones["canvas"]["height"])
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    if any(out_dir.iterdir()):
        raise SystemExit("Use an empty evidence directory; previous evidence is preserved.")
    if bool(args.publish) != bool(args.template):
        raise SystemExit("--publish and --template must be used together")
    issues, inputs = [], []
    if args.publish:
        publish, template = Path(args.publish).resolve(), Path(args.template).resolve()
        issues.extend(check_materials(publish, template))
        inputs.append(fingerprint(template))
        if publish.is_file():
            inputs.append(fingerprint(publish))
    report = None
    if args.layout_report:
        report_path = Path(args.layout_report).resolve()
        report = json.loads(report_path.read_text(encoding="utf-8"))
        inputs.append(fingerprint(report_path))
        if report.get("status") != "SAMPLED_GEOMETRY_CLEAR":
            issues.append("LAYOUT_NOT_CLEAR: " + str(report.get("status")))
        html = Path(report["html"])
        if fingerprint(html)["sha256"] != report.get("htmlSha256"):
            issues.append("LAYOUT_SOURCE_CHANGED")
        inputs.append(fingerprint(html))
        if report.get("schemaVersion") != 2 or not report.get("dependencies"):
            issues.append("LAYOUT_PROVENANCE_MISSING: regenerate layout report")
        for dependency in report.get("dependencies", []):
            dependency_path = Path(dependency["path"])
            if not dependency_path.is_file():
                issues.append("LAYOUT_DEPENDENCY_MISSING: " + str(dependency_path))
            elif fingerprint(dependency_path)["sha256"] != dependency.get("sha256"):
                issues.append("LAYOUT_DEPENDENCY_CHANGED: " + str(dependency_path))

    outputs: list[Path] = []
    for index, frame_arg in enumerate(args.frame, start=1):
        image = load_image(Path(frame_arg).resolve(), canvas, f"frame {index}")
        frame_fingerprint = fingerprint(Path(frame_arg))
        inputs.append(frame_fingerprint)
        if report is not None:
            matching = [f for f in report.get("frames", [])
                        if (report_path.parent / f["file"]).resolve() == Path(frame_arg).resolve()]
            if not matching or matching[0].get("sha256") != frame_fingerprint["sha256"]:
                issues.append("FRAME_NOT_FROM_LAYOUT_REPORT: " + str(frame_arg))
        for key, label in (("top", "TOP UI"), ("right", "RIGHT ACTIONS"), ("lower", "LOWER UI")):
            shade(image, zones["blocked"][key], label)
        core_draw = ImageDraw.Draw(image)
        core_draw.rectangle(rect(zones["core"]), outline=(50, 235, 120, 255), width=7)
        target = out_dir / f"playback-overlay-{index:02d}.png"
        image.convert("RGB").save(target, "PNG")
        outputs.append(target)

    cover_path = Path(args.cover).resolve()
    with Image.open(cover_path) as raw:
        cover = raw.convert("RGBA")
    inputs.append(fingerprint(cover_path))
    crop_box = rect(zones["coverCrop3x4"])
    crop_size = (zones["coverCrop3x4"]["width"], zones["coverCrop3x4"]["height"])
    if cover.size not in (canvas, crop_size):
        raise SystemExit("Cover must be 1080x1920 or 1080x1440; no stretching allowed")
    cover_crop = cover.crop(crop_box) if cover.size == canvas else cover.copy()
    if args.cover_source:
        source = load_image(Path(args.cover_source), canvas, "cover source")
        inputs.append(fingerprint(Path(args.cover_source)))
        if ImageChops.difference(source.crop(crop_box).convert("RGB"), cover_crop.convert("RGB")).getbbox():
            issues.append("DELIVERED_COVER_DIFFERS_FROM_SOURCE_CROP")
    crop_target = out_dir / "cover-crop-3x4.png"
    cover_crop.convert("RGB").save(crop_target, "PNG")
    outputs.append(crop_target)

    thumb_size = (zones["homeThumbnail"]["width"], zones["homeThumbnail"]["height"])
    thumbnail = cover_crop.resize(thumb_size, Image.Resampling.LANCZOS)
    for key, label in (("topLeft", "HOME TOP"), ("bottomLeft", "HOME LOWER")):
        shade(thumbnail, zones["homeThumbnail"]["blocked"][key], label)
    thumb_target = out_dir / "home-thumbnail.png"
    thumbnail.convert("RGB").save(thumb_target, "PNG")
    outputs.append(thumb_target)

    result = {"status": "BLOCK" if issues else "EVIDENCE_GENERATED_NOT_PASS", "issues": issues,
              "inputs": inputs, "outputs": [str(p) for p in outputs],
              "limitations": ["Images still require visual review; field presence does not prove factual correctness.",
                              "Use the delivered cover as --cover. Regenerate affected evidence after input changes."]}
    (out_dir / "evidence.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "issues": issues}, ensure_ascii=False))
    for output in outputs:
        print(output)
    if issues:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
