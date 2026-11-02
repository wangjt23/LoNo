# 拾光产品 Demo

运行 npm run demo:record，再运行 npm run demo:render。输出位于 artifacts/demo/拾光-Exchange与工作记忆-Demo.mp4；源码 demo/index.jsx 使用 Remotion，字幕和分镜来自录制脚本生成的 timeline.json。

录制脚本实际操作 Electron UI，走 EWS XML 解析、AI结构化分类和本地记忆审核调用链；仅把外部邮箱与模型替换为确定性的模拟。所有数据均为虚构。测试独立临时数据目录，避免读取用户工作资料。

npm run test:exchange:timer 会等待真实一分钟定时器，区别于录屏里为简短讲解而手动触发的第二轮同步。视频不把加速剪辑描述为真实等待时长。Remotion与录制依赖只用于开发，不进入App运行包。
