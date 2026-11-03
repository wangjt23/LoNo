# LoNo 0.3.13 · Product film

72 秒 / 1920 × 1080 / 30 fps / H.264 + AAC。Remotion 原生动效，非录屏。

学院紫、珍珠白和透光卡片，搭配描边环形标志、立体运动、分层展开、镜头推进、柔和叠化。示例 UI 是为视频重绘的功能演示，不读取个人数据库或真实邮件。

## 重现

在仓库根目录运行（依赖沿用已锁定的 Remotion / React）：

```sh
node demo/showcase/render.mjs --stills
node demo/showcase/render.mjs --preview
node demo/showcase/render.mjs
```

默认输出 `artifacts/showcase-v0.3.13`，可用 `--out=绝对路径` 指定目录。`--stills` 输出主要分镜与关键状态；`--preview` 输出 960 × 540 预览。Studio：`npx remotion studio demo/showcase/index.jsx --public-dir=.runtime/showcase-public`（先运行一次渲染脚本准备静态资源）。

## 分镜

| 时间 | 内容 |
| --- | --- |
| 0–7s | 品牌引入：把信息，变成行动 |
| 6.5–16s | 多邮箱、企业微信授权桥接，保留来源 |
| 15.5–29s | 快捷输入课表，四条提醒统一确认 |
| 28.5–42s | Agent 创建、编辑、删除，先预览后确认 |
| 41.5–52s | AI 整理标题、时间、重要程度与摘要 |
| 51.5–61s | 已确认的相关记忆在三个入口复用 |
| 60.5–67.5s | Windows / macOS 桌面，同一套体验 |
| 67–72s | 品牌收束与 GitHub 地址 |

## 准确性与素材

- 以 v0.3.13 的现有能力为准。课表多事项拆分展示在快捷记录中，未声称每封邮件自动拆分多项。
- Agent 的修改和删除均展示确认；记忆候选确认后才参与分析。
- 企业微信明确为授权桥接；跨平台不暗示跨设备同步，画面标明本地存储。
- 所有邮件、课表、对话均为合成演示数据。品牌图形来自仓库 `src/ui/brand.svg`。
- 音乐和交互音效由 `score.mjs` 原创程序合成（100 BPM；柔和电钢琴、氛围和弦、低频脉冲与转场风声），无第三方采样。
- 字体使用系统 Microsoft YaHei / Segoe UI，不复制字体文件。跨平台重渲染需可用的中文字库；本次成片在 Windows 渲染。
- Remotion 的使用条款独立于本仓库 MIT 许可证，详见 https://www.remotion.dev/license 。

不修改产品代码或触发发布流水线。渲染结果与生成的 WAV 不纳入 Git。
