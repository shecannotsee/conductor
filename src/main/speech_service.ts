const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { runtimeDir, privateEnv, nodeBinary } = require('./preview_runtime');
const { trackChild, stopChildTree } = require('./child_process_helper');

class SpeechService {
  child = null; active = ''; starting = false; sequence = 0; pending = new Map();
  idleTimer = null; readyPromise = null; notify; loadMs = 0;
  constructor(notify) { this.notify = notify; }
  status() {
    const root = path.join(runtimeDir(), 'speech');
    const available = ['worker.cjs', 'models/encoder.int8.onnx', 'models/decoder.int8.onnx', 'models/tokens.txt', 'models/punctuation.onnx', 'node_modules/sherpa-onnx-node/package.json']
      .every(file => fs.existsSync(path.join(root, file))) && fs.existsSync(nodeBinary());
    return { available, model: 'Paraformer 中文流式 · 本地 CPU', loadMs: this.loadMs };
  }
  async ensureReady() {
    clearTimeout(this.idleTimer);
    if (this.readyPromise) return this.readyPromise;
    if (!this.status().available) throw new Error('语音组件缺失，请安装包含语音模型的完整版本。');
    const root = path.join(runtimeDir(), 'speech');
    const env = privateEnv();
    const nativeDir = path.join(root, 'node_modules', `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`);
    if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = nativeDir;
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = nativeDir;
    const child = trackChild(spawn(nodeBinary(), [path.join(root, 'worker.cjs')], {
      cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    }));
    this.child = child;
    this.readyPromise = new Promise((resolve, reject) => {
      let buffer = ''; let ready = false;
      const timer = setTimeout(() => { reject(new Error('语音模型加载超时，请重试。')); this.dispose(); }, 60000);
      child.stdin.on('error', () => {}); child.stderr.resume();
      child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        if (buffer.length > 1024 * 1024) { this.dispose(); return; }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          let message; try { message = JSON.parse(line); } catch { continue; }
          if (message.type === 'ready') { ready = true; clearTimeout(timer); this.loadMs = message.loadMs; resolve(true); }
          else if (message.requestId && this.pending.has(message.requestId)) {
            const request = this.pending.get(message.requestId); this.pending.delete(message.requestId); clearTimeout(request.timer);
            message.ok ? request.resolve() : request.reject(new Error('语音识别失败，请停止后重试。'));
          } else if (message.sessionId === this.active && ['partial', 'segment'].includes(message.type)) {
            this.notify({ type: message.type, sessionId: this.active, text: String(message.text || '').slice(0, 10000) });
          }
        }
      });
      const failed = () => {
        clearTimeout(timer);
        if (!ready) reject(new Error('语音组件无法启动，请检查系统架构或重新安装完整版本。'));
        if (this.child !== child) return;
        const sessionId = this.active;
        this.child = null; this.readyPromise = null; this.active = '';
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('语音进程已退出。')); }
        this.pending.clear();
        if (sessionId) this.notify({ type: 'error', sessionId, text: '语音进程已退出，已保留确认文字，请重试。' });
      };
      child.once('error', failed); child.once('exit', failed);
    });
    return this.readyPromise;
  }
  request(method, payload = {}) {
    return new Promise<void>((resolve, reject) => {
      if (!this.child || this.child.killed) return reject(new Error('语音进程尚未就绪。'));
      const requestId = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('语音识别处理超时。')); this.dispose(); }, 20000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ method, requestId, ...payload }) + '\n');
    });
  }
  async start(sampleRate) {
    if (this.active || this.starting) throw new Error('已有语音录入进行中。');
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('不支持此麦克风采样率。');
    this.starting = true;
    try {
      await this.ensureReady();
      this.active = crypto.randomUUID();
      await this.request('start', { sessionId: this.active, sampleRate });
      return { sessionId: this.active, loadMs: this.loadMs };
    } catch (error) { this.dispose(); throw error; }
    finally { this.starting = false; }
  }
  async audio(sessionId, samples) {
    if (!this.active || sessionId !== this.active) throw new Error('语音录入已结束。');
    if (!(samples instanceof Float32Array) || samples.length === 0 || samples.length > 48000 || !samples.every(Number.isFinite)) throw new Error('无效的录音数据。');
    if (this.pending.size > 2) throw new Error('录音处理积压，请稍后重试。');
    const audio = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64');
    await this.request('audio', { sessionId, audio });
  }
  async finish(sessionId, cancel = false) {
    if (!this.active || sessionId !== this.active) return;
    try { await this.request(cancel ? 'cancel' : 'stop', { sessionId }); }
    finally { this.active = ''; this.idleTimer = setTimeout(() => this.dispose(), 60000); }
  }
  dispose() {
    clearTimeout(this.idleTimer);
    const child = this.child; this.child = null; this.readyPromise = null; this.active = '';
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('语音录入已取消。')); }
    this.pending.clear();
    if (child) stopChildTree(child);
  }
}
module.exports = { SpeechService };
