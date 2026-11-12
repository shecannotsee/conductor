# Windows Preview 本机验证记录

版本：0.2.0-preview.1。开发分支：feature/windows-preview。独立目录：E:/workspace/conductor-preview。

## 已完成

- TypeScript 主进程和 Renderer 检查；构建；git diff --check。
- 私有环境测试：清除继承的 Codex/API 凭据及 npm 配置，保留外部工具路径。
- 无系统 Node/Codex PATH 时，内置 Node.js 24.14.0、npm、Codex CLI 0.154.0 可执行。
- config.toml/auth.json 四项设置写入、重读、替换/清除 Key、保留其他 TOML 字段、拒绝无效输入。
- API Key 不通过设置读取接口回传 Renderer。
- 使用本地模拟 Responses 服务和假 Key，实际验证 Codex 请求地址、Authorization、model、reasoning.effort 和流式响应。
- exec 首次执行/恢复，app-server 首次执行/恢复，安装目录外工作目录，model/list 均通过。
- 源码、打包程序及安装后程序的首次设置界面、保存、脱敏、独立 userData、重启恢复，未发现 Renderer 异常。
- NSIS 安装、卸载注册入口、同版本覆盖安装保留数据、普通卸载保留数据、显式彻底卸载清理数据及注册入口。
- 上述安装回归分别在普通路径、包含中文和空格的路径通过。静默 /D 参数必须正确加引号。
- 安装/卸载前后用户 PATH 与系统 PATH 完全相同。
- 测试安装已卸载；没有保留 Preview 注册入口或真实用户目录下的 Preview 数据。
- 原目录仍只有最初两处未提交修改，现用 Electron 四个进程 PID 7948 / 21088 / 10916 / 37940 保持运行。

## 尚需用户环境验收

- 没有运行干净 Windows 虚拟机；PATH 隔离测试不能替代干净系统验收。
- 没有使用真实 Magic/OpenAI Key，也没有产生真实 API 请求费用。
- 未验证跨版本数据迁移；当前覆盖安装回归使用同一版本。
- 自动化覆盖的是静默卸载；交互卸载的清理确认框还需人工点击验证。
- 安装包未签名；正式分发前需配置代码签名。
- 两个早期测试留下的临时空目录清理被自动审批策略拒绝（blocked by policy），已保留，不含真实 Key。

## 产物

`src/dist/preview/Conductor-Preview-0.2.0-preview.1-win-x64-Setup.exe`，219722193 字节。

SHA256：`0122a3fd78e1ce213b0aecf2c123932383f79529063b39938b1d108d6f87de75`。

设置截图：`src/dist/preview/settings-smoke.png`。

详细用户步骤与虚拟机验收清单见 [Windows Preview 指南](windows-preview.md)。
