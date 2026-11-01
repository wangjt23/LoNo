# 验收记录

## v0.1.1 审查修复

2026-11-02：17 项核心/回归测试与源码 Electron 桌面流程通过。修复内容与各项验证边界详见 [REVIEW.md](REVIEW.md)。Windows 便携包构建成功，包内源码核对一致；新的打包程序被本机 Device Guard 策略阻止启动，本轮未完成打包程序的运行验收。

## v0.1.0 初版验收（历史记录）

验收日期：2026-11-02（Asia/Shanghai）。系统：Windows 11 x64，Node.js 24.19.0，Electron 45.2.1。

## 已通过

- `node --test tests/*.test.js`：9 项通过。覆盖中文日期/提前提醒、无日期/噪声分类、时区归一、配置密钥保留和加密失败拒绝、模型校验与失败降级、SQLite 重启和去重、通知/完成状态、bridge 协议、IMAP UID 增量与只读行为。
- 实际 Electron 桌面测试：自然语言输入 → 分析预览 → 保存 → 完成/恢复 → 编辑 → 搜索可用界面；设置密钥加密、来源同步、Agent 返回、重复来源不重复调用 Agent、导出、沙箱隔离、全局快捷键注册和重启恢复。
- 同一桌面流程对 `release/win-unpacked/Shiguang Reminder.exe` 全部通过。通知 OS 发送接口被替换为成功/失败事件，真实调度和 SQLite 路径保持不变：失败不标记成功、下轮重试、成功后不重复发送。
- `release/Shiguang-Reminder-0.1.0-win-x64.exe` 单独启动，NSIS 解包、主界面、快捷弹窗、中文解析、SQLite 保存和快捷键注册通过。便携包装器不适配 Playwright Electron 的直接启动握手，因此使用本机 CDP 连接验证，测试结束后已关闭测试进程。
- 已检查空状态、快捷输入分析页、来源页、提醒总览截图。分析后弹窗自动增高，确认按钮在当前屏幕可见。截图在忽略目录 `artifacts/`。
- `npm audit --omit=dev`：运行时依赖 0 项已报告漏洞。完整开发依赖审计有 15 项 moderate，来自 electron-builder 的打包工具依赖链；未强行降级到旧 builder 或以不兼容 overrides 替换 API。没有 high/critical。
- Electron 运行时手动下载后，与 npm 包 `checksums.json` 中 SHA-256 比对一致。打包只包含必要的 SQLite WASM 运行文件和生产依赖。

## 交付产物

- 便携包：`release/Shiguang-Reminder-0.1.0-win-x64.exe`
- 文件大小：128459597 bytes（约 122.5 MiB）
- SHA-256：`2c0ecb7c3dfbdcba158a49f33dafc0806706142e763dce117942bd9d4212af9d`
- 源码、计划、说明、测试均进入本地 Git；运行数据和二进制产物未提交。

## 待真实环境验收

- 真实邮箱授权码、邮件服务商限流和连接差异。
- 企业会话存档权限、SDK 解密服务或 n8n bridge 部署；首版包含消费者和标准协议，不包含企业侧服务。
- 用户所选真实模型/Agent 网关对 JSON 响应格式的支持与内容判断准确率。
- Windows 系统通知实际显示、勿扰模式、登录启动项；自动测试验证了调度与失败恢复，并未替代目标机器的通知权限验收。
- macOS/Linux 打包、通知、系统密钥环和快捷键尚未验证；安装签名、自动更新、OAuth 和重复提醒规则未实现。

这些边界同时记录在 README 和设置界面，不以模拟联通结果宣称真实账号已经接通。
