# LoNo 0.3.4

- GitHub Actions 构建并测试 Windows x64、macOS Apple Silicon 和 Intel 版本，全部成功后自动发布。
- Windows 提供安装版 EXE 和免安装 ZIP；Mac 提供对应架构 DMG，拖入 Applications 后运行。
- 合并 Mac 菜单、Command 快捷键、菜单栏图标及平台 API 适配。
- 保留 0.3.3 的全局隐藏滚动条和长文本换行修复。

更新前请退出旧版，本地数据沿用。Windows 未可信签名；Mac 使用 ad-hoc 临时签名，未使用 Developer ID 或 Apple 公证，Gatekeeper 可能阻止运行。CI 桌面测试使用模拟数据及通知，不能替代真实邮箱、系统授权、系统通知及目标机器安装验收。Windows 安装器生成后尚未自动安装/卸载验收。
