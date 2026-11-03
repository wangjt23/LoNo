# LoNo 产品 Demo

## 产品短片

最新 Demo 是基于 LoNo 0.3.13 的 Remotion 动效短片：72 秒、1920 × 1080、30 fps，使用重绘的产品界面、分镜转场和原创合成配乐，展示多来源提醒、批量创建、Agent 对话、AI 整理与全局记忆。

源码与完整分镜说明见 [showcase/README.md](showcase/README.md)。在仓库根目录安装依赖后运行：

```sh
npm ci
node demo/showcase/render.mjs --stills
node demo/showcase/render.mjs --preview
node demo/showcase/render.mjs
```

成片输出至 `artifacts/showcase-v0.3.13/LoNo-0.3.13-Showcase.mp4`。所有示例内容均为合成数据，不读取个人数据库或真实邮件；生成的视频与音频不纳入 Git。

## Exchange 集成演示

仓库也保留了早期的 Electron 操作录制示例，用于演示和验证 EWS 解析、AI 结构化分类与记忆审核调用链：

```sh
npm run demo:record
npm run demo:render
```

输出位于 `artifacts/demo/LoNo-Exchange与工作记忆-Demo.mp4`；Remotion 源码在 `demo/index.jsx`，分镜来自录制脚本生成的 `timeline.json`。录制使用独立临时数据目录，邮箱与模型均为确定性模拟，不读取用户工作资料。

`npm run test:exchange:timer` 会等待真实一分钟定时器；录制示例为缩短讲解时间，手动触发第二轮同步。Remotion 与录制依赖仅用于开发，不进入 App 运行包。
