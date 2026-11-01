# 拾光提醒 / Shiguang Reminder

Windows 优先、可迁移 macOS/Linux 的本地智能提醒应用。详细设计和后续路线见 [PLAN.md](PLAN.md)。

## 使用

双击 `release/Shiguang-Reminder-0.1.0-win-x64.exe`。这是便携版，不需要安装；第一次启动后请固定放在一个位置。

1. 点击「快速记录」，或按 **Ctrl + Shift + Space** 唤起置顶输入窗口。
2. 输入「明天下午三点提醒我提交材料，提前半小时提醒」，点击分析。
3. 查看并修改标题、重要程度、截止时间、提醒时间，确认保存。没有明确时间时保存为待确认事项。
4. 事项支持完成、恢复、编辑、延后 15 分钟、原文搜索及来源回溯。
5. 在「偏好设置」配置模型、邮箱或企业微信桥接；在「信息来源」手动同步和查看结果。

关闭主窗口后继续在托盘运行；托盘右键可以打开、快速记录或退出。**彻底退出、电脑关机或休眠期间不能发送提醒**；运行中每 15 秒检查，启动和唤醒时检查错过的提醒。发送成功后不会反复弹出；可手动延后再次提醒。请使用设置里的通知测试检查 Windows 通知/勿扰设置。

## 开发

需要 Node.js 22.12+（推荐 24 LTS）、npm、Git。当前实现使用 JavaScript ES Modules，非 TypeScript 工程。

```powershell
npm ci
npm start
npm test
npm run test:desktop
npm run dist:win
```

打包程序也可使用同一套桌面测试：

```powershell
$env:SHIGUANG_EXECUTABLE = (Resolve-Path 'release/win-unpacked/Shiguang Reminder.exe').Path
npm run test:desktop
```

当前验收结果与待验证边界见 [VALIDATION.md](VALIDATION.md)。

Electron 首次运行可能下载运行时，打包时会下载 NSIS 工具。请确保可访问 npm 和 GitHub Releases。Electron binary 的版本和 SHA-256 由其 npm 包校验。运行环境未提供 npm 时可从 Node.js 官方发行版安装完整工具链。

```text
src/core/analyzer.js    中文规则、模型接口、输出校验与降级
src/core/store.js       SQLite、来源去重、提醒状态与持久化
src/core/config.js      配置校验与系统凭据加密
src/core/connectors.js  只读 IMAP、JSON bridge
src/main.js            Electron、调度、托盘、全局快捷键、IPC
src/preload.cjs         最小能力桥接
src/ui/                本地静态界面，无远程脚本
tests/                 核心行为测试
scripts/smoke.mjs      实际 Electron 集成验证
```

## 智能分析与日期

不配置模型也能离线使用中文规则。支持今天、明天、后天、周五、下周一、2026年11月5日、11月5日、下午三点半、14:30、30分钟后、提前半小时等常见表达。日期使用**电脑本地时区**，SQLite 统一存 UTC；采集消息中的相对日期以消息时间为基准，不以同步时间为基准。

仅日期没有钟点时默认 09:00，下午默认 15:00，晚上默认 20:00，分析依据会提示默认规则。复杂/模糊表达如「下班前」「月底」「下周找个时间」需要人工补充。过去日期和低置信度进入待确认。每条来源目前生成至多一项提醒；不支持重复规则、附件识别或全文知识库。

可配置任意兼容 `POST /chat/completions`、支持 JSON 响应的模型或 Agent 网关，填写**完整 URL**、模型名称和 API Key。请求包含 `messages`、`temperature: 0`、`response_format: {type: "json_object"}`。响应的 `choices[0].message.content` 应为以下 JSON 字符串：

```json
{
  "shouldRemind": true,
  "title": "提交项目材料",
  "dueAt": "2026-11-03T15:00:00+08:00",
  "remindAt": "2026-11-03T14:30:00+08:00",
  "priority": "high",
  "confidence": 0.95,
  "reason": "要求本人提交材料，截止时间明确，提前半小时提醒。"
}
```

无明确日期时两个时间为 `null`。输出经过严格校验；超时、网络失败或格式错误会降级为本地规则，界面和来源记录保留降级提示。模型只分类和提取，不执行工具、发送邮件或回复聊天。启用模型意味着输入内容和采集正文会发送到你填写的服务。

## 邮箱

- 开启邮箱 IMAP，填写 TLS 服务器（通常端口 993）、账号和授权码。首版仅支持 TLS 直连，不支持 STARTTLS/OAuth 交互登录。
- 首次读取近 7 天最多 50 封；后续按 UID 增量，每轮最多 50 封，有积压时后续轮询继续。
- 文件夹只读打开，不标记已读、不移动/删除邮件；按账号、文件夹、UIDVALIDITY 和 UID 去重。
- 每封原始 MIME 最多读取 512 KiB，正文最多分析 30000 字符，不提取附件。超长邮件可能截断，需回原邮箱核对。
- 无需处理、广告等邮件保留来源但不创建任务。离线规则属于启发式判断，复杂场景请启用模型并核对结果。

## 企业微信 / n8n 桥接

**普通企业应用的 CorpID/Secret 无法直接拉取任意历史聊天。** 需先由企业管理员开通并授权会话内容存档，部署官方 SDK 解密服务，或通过企业已有服务/n8n 转换数据。首版实现的是桌面端轮询消费者，不包含存档 SDK、企业后台配置、公网回调解密或 n8n 服务部署。

服务契约：

```http
GET /messages?cursor=<previousNextCursor>&limit=100
Authorization: Bearer <bridge-token>
```

```json
{
  "messages": [
    {
      "id": "stable-wecom-msgid-001",
      "text": "明天下午三点前请提交材料，务必按时完成。",
      "sender": "项目组 / 张老师",
      "sentAt": "2026-11-02T10:30:00+08:00"
    }
  ],
  "nextCursor": "opaque-cursor-002"
}
```

- `id` 全局稳定；`sentAt` 必须带时区。每页最多 100 条，响应最大 2 MiB。
- 游标仅在整页成功保存后推进。失败重试通过稳定 ID 去重；禁用/再启用连接不丢失游标。
- 不返回 `nextCursor` 时每轮重复读取接口，通过 ID 去重；建议服务端实现分页。
- 只允许 HTTPS 或 `localhost/127.0.0.1/::1` 的 HTTP；不跟随重定向，避免 Token 随跳转泄露。
- 「信息来源 → 导入桥接 JSON」可导入同结构文件，适合先验证流程。手工导入和接口轮询使用独立 ID 命名空间，应避免同一消息在两条渠道重复导入。
- n8n 可使用「认证过的数据源 → 格式转换 → 持久化游标数据 → Webhook GET 响应」提供此契约，桌面端不要求安装 n8n。

## 本地数据与版本管理

默认数据目录为 `%APPDATA%/shiguang-reminder`，准确路径在偏好设置中显示。SQLite `reminders.sqlite` 保存事项、原文、分析和游标；`settings.json` 保存配置及系统加密后的凭据。文本记录**不做整库加密**，请按工作数据要求保护 Windows 账号和设备。

「导出记录」包含全部事项及来源，不包含连接密钥；导出是 JSON 归档，首版没有通用备份恢复 UI。完整恢复应在退出应用后备份/还原整个数据目录，系统凭据可能无法跨账号/设备解密。不要将数据库、配置或导出文件提交到 Git。

仓库使用本地 Git 分阶段提交；尚未设置远端或推送。`package-lock.json` 固定依赖；运行数据、凭据、截图和构建产物均忽略。Windows 便携包尚未进行代码签名。macOS/Linux 配置已预留，但尚未在对应系统验证。

## 验证边界

自动验证使用本地假模型/bridge 和 IMAP mock，不包含真实邮箱、企业会话存档服务或真实模型账号验收。请在设置连接后检查同步结果和原文时间。Windows 系统通知、勿扰、开机登录项在不同机器上的实际行为需由目标机器验证。
