# Windows 可信签名与 Smart App Control

## 0.2.2 本机可运行目录版（2026-11-02）

用户截图确认0.2.1便携启动器被Smart App Control拒绝。此前一次便携进程能启动不代表稳定通过信誉判断，也不能代替正式签名验收。

重新检查后，原版Electron、builder输出EXE和便携启动器均为 NotSigned。因此没有宣称任何产物具备官方签名。当前提供 release/College-Assistant-0.2.2 目录：不修改原版Electron EXE字节、不新增便携启动器，包含本次app.asar，运行时SHA256与node_modules原版完全相同。

该目录EXE已在本机完成桌面全流程和Exchange模拟闭环测试；实际日常数据目录启动检查显示0.2.2、凭据解密正常、邮件与模型启用、快捷键注册成功。桌面最新版入口已更新。没有关闭智能应用控制、修改注册表信任或Windows执行策略。此结果只证明本机可运行，不推断云端信誉算法，也不承诺其他机器放行；正式分发仍按下文签名流程进行。

## 历史诊断（2026-11-02）

v0.1.1 的启动失败来自 Windows Smart App Control（智能应用控制），不是业务代码异常：

- 只读注册表检查 `VerifiedAndReputablePolicyState=1`，表示强制执行。
- CodeIntegrity 事件 3077 指向 `release/win-unpacked/Shiguang Reminder.exe`，策略 ID 为 `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`。
- 打包主程序未签名；本机证书库没有发现代码签名证书，签名相关环境变量未配置。
- 用户确认没有代码签名证书。因此目前无法完成可信签名及打包程序运行测试。
- `CiTool -lp -json` 返回访问被拒绝；未据此推断存在额外的企业自定义策略。

Smart App Control 对未知、未签名程序可能阻止执行。微软说明它没有单应用的允许例外入口。解决发布身份问题需要受信任 CA 签发的代码签名证书或受支持的可信签名服务；自签名证书不是这里的替代方案。运行时 Electron 与旧版能运行，并不意味着新打包程序会被同样信任，文件内容和信誉判断不同。

本次未关闭保护、修改执行策略、创建证书信任或修改系统应用控制策略。没有声称已经解除拦截。

## 准备好的发布路径

继续保留 `npm run dist:win` 用于未签名开发构建。正式签名使用独立配置与 `release-signed/`，缺少凭据即报错，避免静默退回未签名产物。签名配置匹配项目固定的 electron-builder 26.18.0。

拿到可用签名凭据后，选择一种方式：

1. Windows 证书库：设置 `SHIGUANG_SIGNING_THUMBPRINT`，内容为有可用私钥/硬件令牌支持的代码签名证书指纹。
2. 可导出的受信任证书文件：通过本机环境提供 `WIN_CSC_LINK` 和需要时的 `WIN_CSC_KEY_PASSWORD`。不要在命令历史、源码或聊天中填写密码。现代硬件/云签名证书未必提供 PFX，应使用其供应商支持的签名集成。

不要同时配置两种方式。证书文件、密码、私钥不进入 Git。仓库忽略 PFX/P12，但不应仅依赖忽略规则保护凭据。

```powershell
npm run dist:win:signed
$env:SHIGUANG_EXECUTABLE = (Resolve-Path 'release-signed/win-unpacked/Shiguang Reminder.exe').Path
npm run test:desktop
```

签名配置开启主程序签名和 `forceCodeSigning`。构建后须分别检查主程序及便携外壳的 Authenticode 信任状态（应为 Valid）、发布者和可信时间戳，确认签名有效后再执行桌面测试。需要在签名后的系统上检查是否存在其他被拦截的组件；有效签名也不能覆盖组织额外设置的拒绝规则。

签名验证和 unpacked 桌面流程通过后，再单独验证便携包解包/启动。现有 `test:desktop` 使用 Electron 调试握手，不直接支持 NSIS 便携外壳；不能把测试 unpacked 程序冒充成已经测过便携外壳。

## 本轮验证结果与剩余事项

- 签名配置加载检查通过：无凭据时拒绝构建、非法指纹被拒绝、有效格式的指纹启用强制签名并使用独立目录。
- 17 项现有核心与回归测试再次通过。
- 当前没有真实签名凭据，未运行可信签名构建，也未完成新打包程序的运行测试。
- 检查还发现系统禁止直接执行 PowerShell 脚本文件；试验用的诊断脚本没有执行。未修改该策略，没有保留依赖该脚本的 npm 命令。
- 之前通过只读系统命令读取的签名状态、注册表状态和 CodeIntegrity 事件已足以定位 SAC 原因。后续签名产物需要按照上文单独验收，不能仅根据文件生成成功判断已经解决。

## 官方资料

- [Microsoft：Smart App Control 概述](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview)
- [Microsoft：Smart App Control 常见问题](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)
- [electron-builder v26：Windows 签名配置](https://www.electron.build/v26/docs/win/)
