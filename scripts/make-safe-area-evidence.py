from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


SKILL_DIR = Path(__file__).resolve().parent.parent
ZONES_PATH = SKILL_DIR / "references" / "douyin-1080x1920-safe-zones.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate evidence-only Douyin playback, 3:4 crop, and home-thumbnail previews."
    )
    parser.add_argument("--frame", action="append", required=True, help="Actual 1080x1920 representative frame; repeat as needed.")
    parser.add_argument("--cover", required=True, help="Actual 1080x1920 cover or first frame.")
    parser.add_argument("--out-dir", required=True, help="Directory for deterministic QA evidence files.")
    return parser.parse_args()


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

    outputs: list[Path] = []
    for index, frame_arg in enumerate(args.frame, start=1):
        image = load_image(Path(frame_arg).resolve(), canvas, f"frame {index}")
        for key, label in (("top", "TOP UI"), ("right", "RIGHT ACTIONS"), ("lower", "LOWER UI")):
            shade(image, zones["blocked"][key], label)
        core_draw = ImageDraw.Draw(image)
        core_draw.rectangle(rect(zones["core"]), outline=(50, 235, 120, 255), width=7)
        target = out_dir / f"playback-overlay-{index:02d}.png"
        image.convert("RGB").save(target, "PNG")
        outputs.append(target)

    cover = load_image(Path(args.cover).resolve(), canvas, "cover")
    crop_box = rect(zones["coverCrop3x4"])
    cover_crop = cover.crop(crop_box)
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

    print("EVIDENCE GENERATED; NOT A PASS")
    for output in outputs:
        print(output)


if __name__ == "__main__":
    main()
