# Conductor 0.4.0 Windows 安装版

安装包：`dist/windows/Conductor-0.4.0-win-x64-Setup.exe`。产物位于项目根目录，安装后的程序、开始菜单、快捷方式和卸载入口均为 **Conductor**。

## 安装和工作目录

- 仅当前用户安装，可选择安装目录、桌面快捷方式和开始菜单入口。完成页可启动程序。
- 默认工作目录：`安装目录/workspace`。可以为各对话选择外部目录。
- 内置 Node、npm、Codex 和流式语音识别模型；不注册系统 PATH。
- 应用数据：`%APPDATA%/ConductorInstalled`。源码版使用的 `%APPDATA%/Conductor` 和项目 `.conductor` 不受影响。
- 本版使用独立的应用 ID，与先前的 Conductor Preview 可以并存，不自动迁移其配置和聊天记录。首次使用请填写配置。
- 安装器和卸载器使用 `PerMonitorV2,PerMonitor` DPI 声明，同时提供旧系统 DPI 感知回退。安装器不再请求 Windows 将低分辨率窗口整体拉伸。跨屏移动和 4K 缩放的实际观感仍需在对应显示器上确认。

## API 配置

从输入框上方的“管理配置”或设置菜单的“Codex API 设置”进入。

每套配置保存名称、Base URL、API Key、模型和推理强度。可新增、重命名、修改、清除 Key、删除未使用配置，并设为新对话默认配置。模型候选和支持的强度仍由内置 Codex 提供，可手动输入第三方平台的模型名称。

Key 不回显：留空保留原值，输入新值替换。点击“保存配置”成功后关闭窗口；“保存并测试”会保存填写值并发送简短测试请求，成功后自动关闭，失败时保留窗口显示错误。

输入框上方的下拉框用于选择当前对话的配置。不同对话可以同时使用不同服务商；配置的认证文件、Codex 会话目录、模型和强度互相隔离。切换配置会开始新的 Codex 原生会话，界面中的既有聊天记录保留，但不会自动发送给新服务商。正在运行或排队的对话不能切换，正在被使用的配置不能修改。更改默认配置不会改变已有对话的绑定。

配置文件：默认配置位于 `codex/config.toml`、`codex/auth.json`；新增配置位于 `profiles/<id>/config.toml`、`profiles/<id>/auth.json`。`profiles.json` 只存名称、默认项和对话绑定，不存 Key。

## 卸载和升级

Windows 设置 → 应用 → Conductor → 卸载，或运行安装目录的 `Uninstall Conductor.exe`。

卸载选项：

1. **保留 API 配置**（默认）：保留所有服务商的 Key、模型、强度、地址及名称，移除程序、内置运行环境、模型、聊天记录和缓存。
2. **完全清理应用数据**：同时删除上述 API 配置。

`workspace` 默认保留；需要删除项目时单独勾选，并再次确认。外部工作目录不在卸载范围。覆盖升级保留全部应用数据和 `workspace`。

静默卸载：`/S` 保留 API 配置；`/S --delete-app-data` 完全清理应用数据；额外传 `--delete-workspace` 才删除安装目录内的项目。

## 开发和验证

开发和发布在项目根目录的 `develop` / `main` 分支完成。

构建必须使用 `npm run dist:win`，内部调用 `scripts/build-windows.js`。该脚本复制固定版本 electron-builder 的 NSIS 模板，只替换默认的用户数据清理段，以免误删源码版的同名用户数据目录；不修改 node_modules。不要绕过此脚本直接调用 electron-builder 构建 NSIS。

验证命令：

```text
npm run check
npm run test:preview
node tests/preview-smoke.cjs
node tests/settings-connection-ui.cjs
node tests/uninstall-data.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File tests/release-installer.ps1
```

安装回归脚本拒绝覆盖已有正式安装版及其用户数据；适合干净测试环境。本次 Windows x64 覆盖了真实安装、同版本覆盖升级、配置与工作目录保留、两种卸载方式、原生安装/卸载选项页、安装和卸载器的 DPI manifest、安装版配置界面与语音输入、双服务商并发及续聊、修改 Key、保存和测试后自动关闭。API 验证使用本地 Responses 模拟服务及假 Key，无付费请求。

未签名。macOS/Linux 构建和干净 Windows 虚拟机的硬件、权限组合仍需另行验证。

最终安装包 SHA-256：`d537ff6efcce4087cfcac7f96230078a24068b2c35615f8653dcdb178e865351`。
