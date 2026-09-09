"""Join existing preview checks; never grant visual approval or alter inputs."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("html", "cover", "publish", "template", "out-dir"):
        parser.add_argument("--" + name, required=True)
    for name in ("times", "cover-source", "browser", "puppeteer-package"):
        parser.add_argument("--" + name)
    args = parser.parse_args()
    output = Path(args.out_dir).resolve()
    # A fresh run must never inherit a previous successful summary or old frames.
    output.mkdir(parents=True, exist_ok=False)
    summary_path = output / "preview-check.json"
    summary = {"status": "INCOMPLETE", "issues": [], "layoutReport": None,
               "evidence": None, "visualReview": "NOT_REVIEWED"}

    def save() -> None:
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    save()
    try:
        scripts = Path(__file__).resolve().parent
        layout_dir = output / "layout"
        command = ["node", str(scripts / "check-preview-layout.mjs"),
                   "--html", str(Path(args.html).resolve()), "--out-dir", str(layout_dir)]
        for name in ("times", "browser", "puppeteer-package"):
            value = getattr(args, name.replace("-", "_"))
            if value is not None:
                command.extend(["--" + name, value])
        checked = subprocess.run(command, check=False)
        report_path = layout_dir / "layout-report.json"
        if checked.returncode not in (0, 1) or not report_path.is_file():
            raise RuntimeError(f"Layout inspection incomplete; exit={checked.returncode}")
        report = json.loads(report_path.read_text(encoding="utf-8"))
        summary["layoutReport"] = str(report_path)
        frames = report.get("frames", [])
        if not frames:
            raise RuntimeError("Layout report contains no representative frames")
        evidence_dir = output / "evidence"
        command = [sys.executable, "-X", "utf8", str(scripts / "make-safe-area-evidence.py")]
        for frame in frames:
            frame_path = (layout_dir / frame["file"]).resolve()
            if not frame_path.is_relative_to(layout_dir.resolve()):
                raise RuntimeError("Frame path outside this run")
            command.extend(["--frame", str(frame_path)])
        for name in ("cover", "publish", "template", "cover-source"):
            value = getattr(args, name.replace("-", "_"))
            if value is not None:
                command.extend(["--" + name, str(Path(value).resolve())])
        command.extend(["--layout-report", str(report_path), "--out-dir", str(evidence_dir)])
        generated = subprocess.run(command, check=False)
        evidence_path = evidence_dir / "evidence.json"
        if generated.returncode not in (0, 1) or not evidence_path.is_file():
            raise RuntimeError(f"Evidence generation incomplete; exit={generated.returncode}")
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        summary["evidence"] = str(evidence_path)
        summary["issues"] = evidence.get("issues", [])
        summary["imagesToReview"] = evidence.get("outputs", [])
        if report.get("status") == "BLOCK" or evidence.get("status") == "BLOCK":
            summary["status"] = "BLOCK"
        elif (checked.returncode == 0 and generated.returncode == 0
              and report.get("status") == "SAMPLED_GEOMETRY_CLEAR"
              and evidence.get("status") == "EVIDENCE_GENERATED_NOT_PASS"
              and not summary["issues"] and summary["imagesToReview"]):
            summary["status"] = "READY_FOR_VISUAL_REVIEW"
        else:
            summary["issues"].append("CHECKS_INCOMPLETE")
    except Exception as error:
        summary["status"] = "INCOMPLETE"
        summary["issues"].append(str(error))
    finally:
        save()
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["status"] == "READY_FOR_VISUAL_REVIEW" else 1


if __name__ == "__main__":
    sys.exit(main())
