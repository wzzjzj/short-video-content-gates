# short-video-content-gates

一套面向 Codex 的短视频内容质量 Skill。它用于参考视频分析、选题、脚本、制作前完整预览检查，以及用户明确要求时的发布前审计。

当前版本：**1.7.10**

## 它解决什么问题

- 检查短视频是否有明确受众、单一核心承诺和足够的内容实质。
- 在第一次提交完整预览前，一并核对视频、封面或首屏、标题、文案、话题和必要声明。
- 为抖音 1080×1920 视频提供统一的界面安全区基线。
- 生成播放页遮罩、3:4 封面裁切和主页缩略图证据。
- 仅在用户明确要求判断能否发布或由智能体执行发布时启用严格发布审计。

它不提供账号数据、商业事实、门店配置、素材版权许可、视频制作引擎或自动发布权限。项目仍需维护自己的事实来源和账号规则。

## 适用范围与工具依赖

本 Skill 的内容门禁、脚本审查和质量判断不依赖特定的视频制作工具，可用于 HyperFrames、Remotion 或其他短视频工作流。

目前 `scripts/safe-layout.mjs` 生成的首版安全布局 CSS 面向 HyperFrames 的 HTML/CSS 工作流；其他工具仍可使用内容门禁和渲染后的安全区证据检查，但需要自行按照同一坐标基线完成画面布局。

本项目不会安装 HyperFrames、Remotion 或其他视频制作框架，也不负责生成和渲染视频。

## 安装

### Codex

将整个仓库克隆或复制到用户级 Skills 目录：

```powershell
git clone https://github.com/wzzjzj/short-video-content-gates.git "$env:USERPROFILE\.codex\skills\short-video-content-gates"
```

如果目标目录已经存在，请先确认其中是否有自己的修改；不要直接覆盖。安装后重新启动 Codex，使技能清单刷新。

也可以下载 Release 压缩包，解压后确保目录结构为：

```text
%USERPROFILE%\.codex\skills\short-video-content-gates\SKILL.md
```

## 使用

在请求中明确写：

```text
使用 $short-video-content-gates 审查这条短视频的选题和脚本。
```

安装后也允许 Codex 在匹配的短视频任务中自动调用。严格发布审计不会自动启用，除非用户明确要求判断“能否发布”或要求智能体执行外部发布。

## 工具

生成首版安全信息层 CSS：

```powershell
node scripts/safe-layout.mjs
```

遇到隐藏配置绑定或布局疑点时，可按需执行只读诊断（非固定制作步骤）；抖音 1080×1920 页面同时检查共享安全区内的实际文字边界：

```powershell
node scripts/check-visible-layout.mjs --html index.html --platform douyin
```

省略 `--platform` 时只检查配置绑定是否可见。`NO_STATIC_FINDINGS` 不代表成片通过；动画、遮挡、素材身份、音频和封面仍需按实际输出审查。

生成实际画面的安全区与裁切证据：

```powershell
python scripts/make-safe-area-evidence.py --frame frame.png --cover cover.png --out-dir qa/pre-production-safety
```

该 Python 工具需要 Pillow。它只生成证据图，不会自动判定通过。

首次完整预览可用统一入口串联布局、遮罩、封面裁切、主页缩略图和发布资料检查：

```powershell
python scripts/check-preview-package.py --html index.html --cover cover.png --publish PUBLISH.md --template PUBLISH-TEMPLATE.md --out-dir qa/preview-check
```

入口只返回 `READY_FOR_VISUAL_REVIEW`、`BLOCK` 或 `INCOMPLETE`，不会自动写入质量 PASS。

严格发布审计的检查器与安装钩子分别位于：

- `scripts/check-release.mjs`
- `scripts/install-release-hook.mjs`

具体启用条件和证据结构以 [SKILL.md](SKILL.md) 及 [references](references/) 为准。

## 目录

```text
SKILL.md
agents/
references/
scripts/
```

## 隐私与项目边界

本公开仓库只包含通用方法、坐标基线和工具，不包含作者的私有视频、账号数据、门店信息、本机计划钩子或 HyperFrames 安装配置。

## 许可证

[MIT License](LICENSE)
