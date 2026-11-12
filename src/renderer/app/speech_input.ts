import { codexdesk } from './codexdesk.js';
import { state } from './state_i18n.js';
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = byId<HTMLButtonElement>('btn-speech');
const cancel = byId<HTMLButtonElement>('btn-speech-cancel');
const panel = byId('speech-panel');
const status = byId('speech-status');
const partial = byId('speech-partial');
const input = byId<HTMLTextAreaElement>('input-box');
let phase: 'idle' | 'preparing' | 'recording' | 'finishing' = 'idle';
let generation = 0; let sessionId = ''; let boundContext = ''; let startedAt = 0;
let media: MediaStream = null; let audio: AudioContext = null; let worklet: AudioWorkletNode = null;
let queue: Float32Array[] = []; let draining: Promise<void> = null;
let flushed: (() => void) | null = null; let heartbeat = null;
const contextKey = () => `${state.workspaceMode}:${state.activeConversationId}:${state.activeAgentTeamGroupId}`;
function checked(result) { if (!result.ok) throw new Error(result.error || '语音识别失败'); return result.value; }
function show(next: typeof phase, message: string) {
  phase = next; panel.classList.remove('hidden');
  status.textContent = message;
  button.textContent = next === 'recording' ? '停止录音' : next === 'preparing' ? '正在准备…' : next === 'finishing' ? '正在收尾…' : '语音输入';
  button.disabled = next === 'preparing' || next === 'finishing';
  button.setAttribute('aria-pressed', String(next === 'recording'));
  cancel.classList.toggle('hidden', next === 'idle');
}
async function releaseMicrophone() {
  media?.getTracks().forEach(track => track.stop()); media = null;
  worklet?.disconnect(); worklet = null;
  const context = audio; audio = null;
  if (context && context.state !== 'closed') await context.close().catch(() => {});
}
async function abort(message = '已取消录音；已确认文字保留在输入框。') {
  generation++; sessionId = ''; queue = []; clearInterval(heartbeat); partial.textContent = '';
  show('finishing', message);
  await releaseMicrophone();
  await codexdesk.cancelSpeech().catch(() => {});
  show('idle', message);
}
function pump() {
  if (draining || !queue.length) return;
  const token = generation;
  draining = (async () => {
    while (queue.length && token === generation && sessionId) {
      checked(await codexdesk.sendSpeechAudio(sessionId, queue.shift()));
    }
  })().catch(error => { if (token === generation) void abort(error.message); }).finally(() => {
    draining = null; if (queue.length && token === generation) pump();
  });
}
async function start() {
  if (input.disabled) { show('idle', '请先选择一个可输入的会话。'); return; }
  const token = ++generation; boundContext = contextKey(); partial.textContent = '';
  show('preparing', '正在准备本地语音模型和麦克风…');
  try {
    const info = checked(await codexdesk.speechStatus());
    if (token !== generation) return;
    if (!info.available) throw new Error('未找到本地语音模型，请安装含语音功能的完整版本。');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    if (token !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
    media = stream;
    media.getAudioTracks()[0].onended = () => { if (phase === 'recording') void abort('麦克风已断开，已保留确认文字。'); };
    audio = new AudioContext();
    await audio.audioWorklet.addModule(new URL('../audio/pcm-worklet.js', import.meta.url));
    if (token !== generation) return;
    const result = checked(await codexdesk.startSpeech(audio.sampleRate));
    if (token !== generation) { await codexdesk.cancelSpeech(); return; }
    sessionId = result.sessionId;
    worklet = new AudioWorkletNode(audio, 'conductor-pcm');
    worklet.port.onmessage = event => {
      if (event.data.type === 'flushed') { flushed?.(); flushed = null; return; }
      if (phase === 'finishing' && !flushed) return;
      if (token !== generation || !sessionId) return;
      if (contextKey() !== boundContext) { void abort('会话已切换，录音已取消。'); return; }
      if (queue.length >= 50) { void abort('识别速度跟不上录音，已停止；请关闭其他高负载程序后重试。'); return; }
      queue.push(event.data.samples); pump();
    };
    const source = audio.createMediaStreamSource(media);
    const mute = audio.createGain(); mute.gain.value = 0;
    source.connect(worklet); worklet.connect(mute); mute.connect(audio.destination);
    await audio.resume();
    if (token !== generation) return;
    startedAt = Date.now(); show('recording', '正在本地识别 · 0 秒');
    heartbeat = setInterval(() => {
      if (contextKey() !== boundContext) { void abort('会话已切换，录音已取消。'); return; }
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      status.textContent = `正在本地识别 · ${seconds} 秒`;
      if (seconds >= 590) void stop();
    }, 250);
  } catch (error) {
    if (token !== generation) return;
    const message = error.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在系统隐私设置中允许 Conductor 访问麦克风。'
      : error.name === 'NotFoundError' ? '未找到麦克风，请连接录音设备。'
      : error.message || '无法启动语音输入。';
    await abort(message);
  }
}
async function stop() {
  if (phase !== 'recording') return;
  const token = generation; clearInterval(heartbeat); show('finishing', '正在补齐末尾文字和标点…');
  try {
    await new Promise<void>(resolve => { const timeout = setTimeout(resolve, 500); flushed = () => { clearTimeout(timeout); resolve(); }; worklet?.port.postMessage('flush'); });
    await releaseMicrophone();
    while (draining) await draining;
    if (token !== generation) return;
    checked(await codexdesk.stopSpeech(sessionId));
    if (token !== generation) return;
    sessionId = ''; partial.textContent = ''; show('idle', '语音已转入输入框，请检查后手动发送。');
  } catch (error) { if (token === generation) await abort(error.message); }
}
button.addEventListener('click', () => { if (phase === 'idle') void start(); else if (phase === 'recording') void stop(); });
cancel.addEventListener('click', () => { void abort(); });
codexdesk.onSpeechEvent(event => {
  if (!sessionId || event.sessionId !== sessionId) return;
  if (contextKey() !== boundContext) { void abort('会话已切换，录音已取消。'); return; }
  if (event.type === 'error') { void abort(event.text); return; }
  if (event.type === 'partial') partial.textContent = event.text;
  if (event.type === 'segment' && event.text) {
    // Append finalized segments in order; focus changes must not reorder dictated sentences.
    const caret = input.value.length;
    input.setRangeText(event.text, caret, caret, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    partial.textContent = '';
  }
});
// Do not send a message while an unfinished utterance is still being decoded.
for (const id of ['btn-send', 'btn-insert-message']) byId(id)?.addEventListener('click', event => {
  if (phase === 'idle') return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (phase === 'recording') void stop();
}, true);
window.addEventListener('beforeunload', () => { media?.getTracks().forEach(track => track.stop()); void codexdesk.cancelSpeech(); });
