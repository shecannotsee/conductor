# Windows Preview 安装与验收

本分支提供 Conductor Preview，与现有 Conductor 分开安装、存储数据。目标平台为 Windows 10/11 x64。

## 用户安装

运行 `Conductor-Preview-0.3.0-preview.1-win-x64-Setup.exe`，选择目录并完成安装，从开始菜单启动 Conductor Preview。首次启动填写 Base URL、API Key、模型名字、推理强度。可刷新 Codex 候选模型，也可直接填写平台提供的模型名；候选列表不代表第三方平台的授权范围。点击“保存并测试”会发送一次简短请求，可能产生少量费用。之后选择项目目录开始使用。设置菜单中的“Codex API 设置”可再次修改。

本版未做代码签名。测试包不是正式签名发行版。

## 隔离边界

- 自带 Node.js 24.14.0（含 npm）、Codex CLI 0.154.0；Electron 具体版本由 package-lock.json 固定。
- 不注册系统 PATH，不改动外部 Node/npm/Codex。
- 配置和应用数据：`%APPDATA%\Conductor Preview`。
- Codex 配置：该目录下 `codex/config.toml` 与 `codex/auth.json`，仅内部子进程使用此 CODEX_HOME。
- Key 在 auth.json 中按 Codex 原生格式明文保存；目录权限限制为当前用户和 SYSTEM，界面不回显 Key。
- 私有 npm 前缀、缓存和 npmrc 均在 Preview 数据目录下，不复用用户 npmrc。
- Codex 子进程保留外部工具 PATH，可操作用户选择的项目；这不是文件系统隔离沙箱。
- 默认工作区为用户主目录下 `Conductor Preview Workspace`，卸载不删除它或用户选择的其他项目。
- 运行中的会话结束后才允许保存新配置；后续任务使用新配置。
- 不自动迁移原版 .conductor、个人 .codex 或旧会话；需要时手动导入会话副本。

## 卸载与升级

从 Windows“已安装的应用”卸载 Conductor Preview。交互卸载会询问是否同时删除配置、Key、会话和缓存，默认保留。更新过程保留数据。安装目录中的私有组件随程序移除，外部 Node/npm/Codex 和项目保持不变。

静默卸载默认保留数据；electron-builder 支持 `--delete-app-data` 显式清理。本应用只提供当前用户安装，不支持全机器安装。自动更新暂未实现，使用同一应用标识的新版安装包覆盖升级。

## 开发与构建

在独立 worktree 的 src 目录运行：

```powershell
npm ci
npm run prepare:runtime
npm run check
npm run test:preview
npm run test:preview:ui
npm run dist:win
```

`prepare:runtime` 下载固定版本的官方 Node ZIP，验证官方 SHASUMS256，按独立锁文件安装 Codex 平台包。下载和安装均限制在本 worktree 的 src 下；不执行全局 npm 安装。产物在 `src/dist/preview/`。安装包已包含运行环境，目标机器安装时无需下载 Node/npm/Codex。

测试打包后的界面：

```powershell
node tests/preview-smoke.cjs '完整路径\Conductor Preview.exe'
```

自动测试使用临时 APPDATA 和假 Key。本地模拟 Responses 服务覆盖四项配置、流式返回、exec/app-server 的首次执行与恢复，不调用真实付费 API。

## 干净虚拟机验收清单

1. Windows 10/11 x64 建立快照，不安装 Node/npm/Codex。
2. 终端记录 `where.exe node`、`where.exe npm`、`where.exe codex` 的结果。
3. 安装 Preview，验证开始菜单、桌面快捷方式和卸载入口。
4. 填写测试账号四项配置并测试真实 API；错误 Key/地址/模型应得到明确失败提示。
5. 在安装目录以外的新测试项目中读写文件，安装 Git 后验证调用外部 Git。
6. 关闭并重启应用和系统，检查设置及会话保留。
7. 再次执行第 2 步，确认没有新增全局命令。
8. 覆盖安装同标识新版，检查配置、会话和快捷方式。
9. 普通卸载保留配置；重装可恢复配置。
10. 再做彻底卸载，确认 Preview 的配置、Key、会话和缓存清除，而项目文件仍在。
11. 恢复快照，安装独立的 Node/npm/Codex，重复安装、运行和卸载，确认原有命令路径、版本及配置不变。
12. 覆盖中文和空格安装路径、普通非管理员账号、离线安装。

真实 API、干净 Windows、跨版本升级和交互式彻底卸载需按此清单实测，不能用源码构建通过替代。

## 本机安装回归脚本

`src/tests/preview-installer.ps1` 会在不存在 Preview 安装和数据时测试安装、已安装界面、同版本覆盖安装、保留数据卸载及彻底卸载，并核对注册入口和 PATH。它会临时注册 Preview，因此建议在测试机执行；发现已有 Preview 数据就直接退出。中文/空格路径通过 `/D="完整路径"` 作为最后一个参数传给 electron-builder NSIS 安装器。


## 本地语音输入

新版含中文流式语音模型，点击输入框旁“语音输入”即可使用。详见 [语音输入、跨平台构建与测试](voice-input.md)。
