# 抖音发布机器证据

`release-evidence.json` 只在用户明确要求判断“能否发布”或要求智能体执行外部发布时生成，用于保存本条视频的待发布文件、哈希、证据路径和实际审查结果；正式门禁结论仍写在现有 `PUBLISH.md`。普通本地制作、完整预览和正式包交付不需要该文件，也不得留下待办。该文件不得保存或覆盖共享安全区坐标，也不决定制作任务是否完成。

## 最低结构

```json
{
  "schemaVersion": 1,
  "platform": "douyin",
  "checkedAt": "2026-08-31T12:00:00+08:00",
  "canvas": { "width": 1080, "height": 1920 },
  "artifacts": {
    "video": { "path": "renders/final.mp4", "sha256": "64位十六进制SHA-256" },
    "cover": { "path": "cover.png", "sha256": "64位十六进制SHA-256" }
  },
  "evidence": {
    "playbackOverlay": ["previews/release/playback-01.png"],
    "coverCrop3x4": "previews/release/cover-3x4.png",
    "homeThumbnail": "previews/release/home-thumbnail.png"
  },
  "review": {
    "top": "PASS",
    "right": "PASS",
    "lower": "PASS",
    "coverCrop3x4": "PASS",
    "homeThumbnail": "PASS"
  },
  "criticalElements": [
    { "id": "final-title", "x": 120, "y": 360, "width": 620, "height": 180 }
  ]
}
```

## 约束

- 所有路径必须相对当前视频目录，不能逃逸到目录外；证据路径必须指向实际存在的图片。
- `artifacts.video` 和 `artifacts.cover` 必须分别指向待发布 MP4 和待发布封面，SHA-256 必须与当前文件一致。
- `review.top`、`right`、`lower`、`coverCrop3x4`、`homeThumbnail` 必须全部为 `PASS`。个人号没有团购也不能把 `lower` 写成不适用。
- `criticalElements` 保存本条视频实际关键文字、字幕、Logo、CTA 或标签的边界，不保存共享安全区。共享检查器负责按 `gate-model.md` 判定。
- 待发布成片、封面或发布材料发生变化后，原哈希和 `pre-publish` 结论立即失效，必须重新生成证据并复核。

## 验证

在视频项目根目录提供的薄入口中运行：

```text
npm.cmd run check:release -- --video "<视频目录>"
```

也可直接执行本 Skill 的 `scripts/check-release.mjs --video <视频目录>`。退出码非零即为 BLOCK；项目脚本不得吞掉退出码或自行放宽判定。

只有项目提供自动 `publish` 脚本且用户明确要求由智能体执行发布时，项目根入口才调用 `scripts/install-release-hook.mjs`，把共享检查接入该工程的 npm `prepublish` 生命周期。用户自行在手机端发布不需要安装该钩子。已有不同的 `prepublish` 不会被覆盖，必须人工合并后复核。
