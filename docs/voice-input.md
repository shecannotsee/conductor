# 本地流式语音输入

Conductor 提供中文优先的本地流式语音输入，安装版内置模型和运行环境。

## 使用

1. 打开或新建一个对话，在输入框旁点击“语音输入”。
2. 允许系统麦克风权限。首次录音加载本地模型，随后开始计时。
3. 说话时，输入框上方显示可修正的临时结果。停顿确认后，补齐标点的句子追加到草稿末尾。
4. 点击“停止录音”补齐末尾内容，检查后手动发送。录音中点击发送只会先结束录音，不自动发送。
5. “取消录音”丢弃未确认部分，保留已确认文字。切换对话或团队自动取消，避免写入其他草稿。

语音功能不需要 API Key。音频不上传、不写入录音文件；确认文字与手动输入相同，点击发送后才进入所选 Codex/API 对话。使用默认系统麦克风；暂不提供设备选择器。单次录音约十分钟后自动收尾。

## 模型与运行环境

- sherpa-onnx-node 2.0.1，私有 Node.js 24.14.0，CPU 后台进程，两个 ASR 推理线程。
- Paraformer bilingual zh-en streaming：INT8 encoder/decoder，约 237 MB。
- CT-Transformer zh/en 标点模型，约 294 MB。
- 模型文件来自固定仓库 revision，逐个校验 SHA256；清单在 `src/speech-package/models.json`。
- 完整安装包包含模型，不需要首次运行下载，不要求系统安装 Python、Node、CUDA 或配置 PATH。
- 麦克风由 Electron/Web Audio 采集，AudioWorklet 以 100ms PCM 分块；通过受校验的 IPC 和子进程标准输入输出传递，不监听网络端口。
- 原始采样率交由 sherpa-onnx 重采样。模型延迟受模型内部音频分块、实际 CPU 推理及停顿判定共同影响；当前句尾静音阈值为 1.2 秒。
- 停止后保留热模型一分钟，之后释放进程和内存；取消直接释放。
- 首次语音模型加载失败、麦克风权限拒绝、设备断开、处理积压均有界面提示。

模型可能错误识别人名、代码标识符、英文缩写和数字，请在发送前检查。没有使用 LLM 自动润色。

## 跨平台边界

同一份 Renderer、语音服务和 Node sidecar 支持 Windows/macOS/Linux；sherpa-onnx 提供各平台 x64/ARM64 原生包。模型文件共用，运行程序按目标平台构建。语音原生库路径仅注入私有子进程，不修改系统环境变量。

分别在目标平台、目标架构的构建机执行：

```sh
cd src
npm ci
npm run dist:win    # Windows x64
npm run dist:mac    # macOS，当前构建机架构
npm run dist:linux  # Linux，当前构建机架构
```

Node/Codex 运行时准备脚本已按平台与架构选择官方分发包。macOS 包含麦克风用途说明和音频权限 entitlement；正式发布还需签名、公证。Linux 仍依赖操作系统的音频服务以及 Electron 支持的系统库/ABI。Windows 原生语音库的导入表未发现额外 MSVC 运行库依赖，但干净系统仍需实测。

本次只构建并运行验证了 Windows x64，macOS/Linux 构建、签名、音频权限及运行时兼容性尚待相应机器验收，不能将其视为已交付可用的跨平台安装包。

## 测试

```sh
npm run prepare:runtime
npm run prepare:speech
npm run test:speech
npm run test:speech:ui
```

测试音频从固定版本的上游示例获取，测试下载可通过 HTTPS_PROXY/HTTP_PROXY 配置构建代理；不打入用户安装包。UI 测试使用 Chromium 模拟麦克风回放真实音频，覆盖采集、重采样、IPC、原生识别、标点、草稿追加、停止/取消和会话切换；不代表真人麦克风与不同声学环境下的准确率。

`tests/release-installer.ps1` 会测试真实安装程序，包括安装后语音输入、普通/彻底卸载和 PATH 不变，要求机器不存在正式安装版或其数据。建议在虚拟机运行。

## 许可证与分发

运行时许可证与模型许可证分别保留在 `resources/runtime/speech/licenses`：sherpa-onnx 使用 Apache-2.0；转换后的 Paraformer 模型卡标注 Apache-2.0；标点权重源自 FunASR，随包保留其自定义模型协议及转换来源，不将全部权重统称为 Apache/MIT。上游来源和修订号均在清单及模型卡中记录。
