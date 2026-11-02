# 拾光提醒 · 开发计划

## 目标与范围

面向 Windows、保留 macOS/Linux 迁移能力的本地优先智能提醒应用。第一阶段覆盖快捷输入、时间和重要程度分析、本地记录、桌面提醒、邮件定时采集、企业微信授权数据桥接和模型接入。全文知识库、自动沟通、完整工时分析与周月报为后续阶段，不在首版冒充已实现。

## 技术决策

- Electron + JavaScript ES Modules，JSDoc 描述边界，避免首版引入复杂构建链；后续可逐步迁移 TypeScript。
- 本地 SQLite（sql.js），参数化查询、持久化原子替换；凭据使用 Electron safeStorage/Windows DPAPI 加密，记录本身保存在本地而非默认整库加密。
- UI 无远程脚本，contextIsolation + sandbox + 限定 IPC，主进程负责网络和文件访问。
- 中文规则解析离线可用；可配置兼容 chat/completions JSON 响应的模型/Agent 网关。外部内容仅作为待分析数据，不执行模型工具或指令。模型失败时明确展示降级结果。
- 邮件使用 IMAP TLS + 邮箱授权码，按 UID 和 UIDVALIDITY 去重；首轮只读最近邮件；同步状态和失败可见。
- 企业微信普通应用无法读取任意历史聊天。通过企业已授权的会话存档服务或 n8n，轮询标准 JSON bridge；支持手工导入同样数据。会话存档 SDK 解密和公网回调部署不放在桌面端实现。
- n8n 是可选服务端集成层，不嵌入其源码或强制部署。默认不发送通知给他人。

## 开发步骤与提交

1. `docs: record implementation plan`：计划、边界、验收标准、研究来源。
2. `feat: add local reminder engine`：中文日期解析、模型输出校验、SQLite、去重、提醒调度、核心测试。
3. `feat: add desktop workspace and connectors`：主界面、悬浮输入、托盘、全局快捷键、系统通知、设置、IMAP 和 bridge 轮询、凭据保护。
4. `test: validate desktop flows and package Windows app`：实际 Electron 流程验证、截图检查、Windows 安装/便携构建、操作文档及已知限制。

## 验收标准

- `Ctrl+Shift+Space` 唤起悬浮窗口；输入“明天下午三点提醒我提交材料”后能查看并修改标题、截止/提醒时间、优先级，再保存。
- 不接模型也可用；没有明确日期的记录进入待确认，不编造确定日期；过去时间显示风险。
- 任务完成、恢复、延后、搜索、查看来源；重启后数据仍存在。
- 每次启动和系统唤醒检查到期任务；运行期间定期检查；已通知记录避免连续重复弹出；退出后不声称仍会提醒。
- 邮件/bridge 定期同步、重复数据不生成重复任务；没有真实凭据时用受控模拟服务验证，明确区分已验证和待真实环境验收。
- 设置可以配置模型、IMAP、bridge、轮询频率和开机启动；密钥不回传界面或写入 Git。
- 核心自动测试通过，实际桌面 smoke test 通过，输出 Windows 可运行包。

## 后续阶段

首版状态（2026-11-02）：步骤 1–4 已完成。9 项核心测试、开发/打包桌面流程和便携 EXE 启动验证通过；详见 [VALIDATION.md](VALIDATION.md)。真实账号和跨平台验收仍按下列路线推进。

- P2：OAuth 邮箱登录、企业微信官方 SDK 独立桥接服务、增量分页、大数据 SQLite 原生后端、通知历史/重复规则、静默时段。
- P3：附件和文件全文检索、知识库、工作事件流、周月报、复盘建议。
- P4：macOS/Linux 平台验收、签名发布、更新机制、多端同步（单独明确数据策略）。

## 研究与限制

- https://share.gemini.google/k3JCNTwODqlv — 2026-11-02 当前工具无法读取，不根据不可见内容推断结论。
- https://github.com/n8n-io/n8n — 可选工作流编排；若后续分发/嵌入需独立确认许可。
- https://www.electronjs.org/docs/latest/tutorial/security — Electron 隔离与权限建议。
- https://www.electronjs.org/docs/latest/api/global-shortcut — 全局快捷键可能与其他程序冲突，需显示注册结果。
- https://www.electronjs.org/docs/latest/api/safe-storage — 平台密钥保护；不允许 Linux basic_text 降级保存凭据。
- https://imapflow.com/docs/guides/fetching-messages/ — 邮件采集和 UID。
- https://developer.work.weixin.qq.com/document/path/91774 — 官方会话存档接口入口；当前抓取工具不可读，真实接入必须根据企业权限验证。

## 2026-11-02 扩展：长期记忆与经验沉淀

将工作记忆提前实现为核心能力：来源 → 候选提取 → 用户确认 → 相关记忆检索 → 新任务辅助分析 → 来源与使用依据回溯。

本轮完成 SQLite 迁移、四类记忆、审核/编辑/忽略/删除、原文证据、规范化去重、本地检索、模型上下文、导出以及桌面验收。原文不直接成为可信指令；未确认记忆不进入模型上下文。自动提取先使用保守本地规则，复杂内容按记录主动调用模型。

后续继续演进：向量与关键词混合检索、记忆冲突和有效期、按人/事项聚合的工作事件流、经确认的流程模板、周月报。跨应用权限与真实数据源验收仍分别推进。
