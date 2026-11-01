# 界面与快捷记录改版

2026-11-02，应用于当前源码版；Git 提交记录是本次界面版本的依据。

## 设计

### 毛玻璃材质迭代

- Windows 11 22H2+ 使用系统 Acrylic；macOS 预留 `under-window` Vibrancy；其他系统、减少透明度或高对比度使用实色回退。
- 文档背景透明，侧栏/快捷弹窗以低不透明度表面承接真实背景模糊。内容区、输入框和卡片逐层增加不透明度，文字保持完全不透明。应用以浅色材质呈现，不修改系统的透明度/安全策略。
- 系统主题或辅助功能偏好变化后更新窗口材质。保留所有快捷键和草稿行为。
- `node scripts/glass-preview.mjs` 创建受控彩色背景，通过系统合成画面检查背景模糊，避免只根据页面截图误判。保存前核对背景标记，背景被其他窗口遮挡时拒绝保存。测试窗口和数据均在退出后关闭。
- Windows 已检查 `glass-native-input.png`、`glass-native-preview.png`、`glass-native-workspace.png`：背景网格在窗口下被模糊，色彩透过表面，输入内容仍清晰。macOS 原生材质尚未实机验证。
- 材质接口依据 [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) 和当前安装的 Electron 45.2.1 类型定义。

### 布局与交互

- 主窗口：灰色导航侧栏、白色内容面板、单一蓝色主操作、统一细边框与圆角。去除装饰性英文和重复的面包屑；提醒、来源、设置沿用同一套控件。
- 提醒列表：标题优先，来源/时间次之，重要程度使用小标记；保持完成、详情和搜索入口直接可用。
- 快捷窗口：无系统标题栏，顶部可拖动，初始约 680×310；输入后才展开为约 680×640。尺寸按屏幕可用区域收缩；展开保留位置，普通输入不会把拖动后的窗口移回中央。
- 输入状态：保留一个文本输入框和主操作。分析依据折叠，模型失败警告保留可见。
- 键盘：Ctrl/Command+Enter 先分析、再保存；普通 Enter 换行；Esc 收起并保留草稿；保存成功后自动收起并清空已保存输入。避免在中文输入法组合期间触发确认。
- 主界面 Ctrl/Command+F 聚焦搜索。全局快捷键在弹窗获得焦点时可收起，否则唤起。
- 系统字体和本地 SVG 图标，不加载远程字体/图片。保留清晰的焦点提示，并尊重系统减少动态效果偏好。

设计参考 [Apple Human Interface Guidelines：Materials](https://developer.apple.com/design/human-interface-guidelines/materials) 对功能层次和内容可读性的建议；不依赖 Apple 专有字体或平台材质。

## 验证

- 17 项核心/回归测试通过。
- Electron 源码桌面流程通过：输入/展开布局无保存按钮裁切、Ctrl+Enter 分析与保存、保存后隐藏、Esc 草稿保留、Ctrl+F 搜索、已完成事项编辑、配置保存、桥接和模型流程、通知状态与重启。
- 检查截图：`artifacts/00-quick-capture.png`（输入）、`02-capture.png`（展开）、`01-empty.png`（空状态）、`03-sources.png`（来源）、`04-workspace.png`（列表）。截图使用测试数据，不包含用户工作记录。
- 当前用户旧版进程未关闭。旧版若占用全局快捷键，新进程会显示提示，可通过主界面按钮打开弹窗。
- 本轮未重新构建便携包，也没有改变 Smart App Control 状态；现有签名限制保持在 WINDOWS-SIGNING.md 中记录的状态。
