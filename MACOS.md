# macOS 构建与验收

已提供 Apple Silicon（arm64）和 Intel（x64）两种 DMG 配置。DMG 由 GitHub Actions 的对应原生 Mac runner 构建、挂载校验并运行打包后的桌面测试；真实邮箱、通知授权及用户机器上的安装仍需单独验收。

## 在 Mac 上打包

安装 Node.js 24 和 npm，在仓库目录执行：

```sh
npm ci
npm test
npm run dist:mac
```

也可只运行 `npm run dist:mac:arm64` 或 `npm run dist:mac:x64`。输出目录为 `release/`：

- `LoNo-<版本>-mac-arm64.dmg`：Apple Silicon。
- `LoNo-<版本>-mac-x64.dmg`：Intel。

打开 DMG，将 LoNo 拖入 Applications，再从 Applications 启动。更新前从菜单退出旧版。图标由 `node scripts/generate-mac-icon.mjs` 从现有品牌绘制代码生成，修改品牌时重新运行并提交 `src/assets/LoNo.icns`。

## GitHub Actions

Actions → Desktop CI and Release。普通 main 提交和 PR 自动运行核心测试；推送 v* 标签后，检查标签与 package.json 版本一致，分别在 Windows、Apple Silicon 和 Intel runner 构建并测试。全部成功后自动创建 GitHub 预发布版本，包含 Windows 安装版、免安装 ZIP、两种 Mac DMG 及 SHA256SUMS。也可手动运行构建，仅保存 Artifacts，不自动发布。

`dist:mac*` 使用独立的 `electron-builder.mac.cjs` 测试配置：明确使用 ad-hoc 临时签名（`identity: '-'`）、关闭 hardened runtime 和公证。当前锁定的 electron-builder 不会在缺少证书时自动选择临时签名；显式重签可避免重命名、修改后的 Electron 包保留失效签名。CI 不使用开发者证书或 Apple 公证凭据，产物用于测试预发布。这不等于 Developer ID 签名，下载到其他 Mac 后可能被 Gatekeeper 阻止。正式分发需使用独立配置启用 hardened runtime、Developer ID 签名及公证，并完成目标机安装验收。

electron-builder 支持通过 `CSC_LINK`、`CSC_KEY_PASSWORD` 载入证书，通过 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 配置公证。凭据应保存在本机环境或专用 CI Secrets，不写入仓库。当前测试工作流不接入这些 Secrets；正式发布时需另建要求签名、公证成功的发布流程。参见 [macOS 配置](https://www.electron.build/mac/) 和 [签名文档](https://www.electron.build/code-signing-mac.html)。

## 窗口外观

从0.3.9起，Mac和Windows共用界面代码，并按平台配置原生窗口控件。Mac隐藏独立原生标题栏，红黄绿按钮放在侧栏顶部，侧栏和内容顶部保留拖动区；窗口缩小时导航切换为紧凑间距。Windows继续在右上角显示原生最小化、最大化、关闭按钮。

## 使用与手工验收

- 快速记录：`Command+Shift+Space`；备用 `Command+Option+Space`。系统占用时会显示备用键或冲突提示。
- 搜索：`Command+F`。应用菜单提供编辑、隐藏、退出，Dock 图标可重新打开主窗口。
- 关闭主窗口后在菜单栏继续运行；从菜单栏或应用菜单退出后停止提醒。
- 本地数据：`~/Library/Application Support/shiguang-reminder`。密码和密钥使用 macOS Keychain；Windows 加密的凭据不能直接迁移到 Mac。
- 在目标 Mac 验证：DMG 拖拽安装、启动与更新、菜单栏深浅色、快捷键冲突与快速输入、首次通知授权与点击通知、睡眠唤醒补提醒、登录启动开关、退出与重新启动后的数据保存。真实邮箱/EWS 登录仍需独立验证。

打包应用自动验证示例（arm64，Intel 将 `mac-arm64` 改为 `mac`）：

```sh
SHIGUANG_EXECUTABLE="$PWD/release/mac-arm64/LoNo.app/Contents/MacOS/LoNo" npm run test:desktop
```

桌面测试使用独立临时数据和模拟通知，不能代替系统通知、Keychain 授权、登录项或真实邮箱的实机验收。

## 本地 Review（2026-11-02）

已修正启动时无条件调用 Windows AppID API，以及 macOS 不适用的窗口菜单栏 API。对应平台范围见 Electron 的 [App API](https://www.electronjs.org/docs/latest/api/app#appsetappusermodelidid-windows) 和 [BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window#winsetmenubarvisibilityvisible-windows-linux)。通知提示和登录启动文案已改为系统通用表述。

已按锁定的 electron-builder 26.18.0 源码复核临时签名路径，增加独立测试签名配置，并为后续 CI 增加 DMG 校验、安装副本签名校验、原生架构及 Mac 菜单/快捷键断言。

Windows 本地验证：66 项核心测试通过，完整桌面回归通过，Mac 打包配置 schema 校验、工作流 YAML 及仅手动触发配置校验通过。Mac 签名执行、DMG 生成及 Mac 桌面断言以对应 Actions runner 的运行结果为准。
