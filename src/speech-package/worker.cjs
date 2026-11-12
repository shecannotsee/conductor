// Private Node sidecar. No sockets, audio files, API credentials or external commands.
const path = require('node:path');
const readline = require('node:readline');
const sherpa = require('sherpa-onnx-node');
const modelDir = path.join(__dirname, 'models');
const started = performance.now();
const recognizer = new sherpa.OnlineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    paraformer: { encoder: path.join(modelDir, 'encoder.int8.onnx'), decoder: path.join(modelDir, 'decoder.int8.onnx') },
    tokens: path.join(modelDir, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0,
  },
  decodingMethod: 'greedy_search', enableEndpoint: true,
  rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 25,
});
const punctuation = new sherpa.OfflinePunctuation({ model: { ctTransformer: path.join(modelDir, 'punctuation.onnx'), numThreads: 1, provider: 'cpu', debug: 0 } });
let active = null;
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
function publish(final) {
  const text = recognizer.getResult(active.stream).text.trim();
  if (final) {
    if (text) emit({ type: 'segment', sessionId: active.id, text: punctuation.addPunct(text) });
    active.lastText = '';
  } else if (text !== active.lastText) {
    active.lastText = text;
    emit({ type: 'partial', sessionId: active.id, text });
  }
}
function decode() { while (recognizer.isReady(active.stream)) recognizer.decode(active.stream); }
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  let message;
  try {
    if (line.length > 1024 * 1024) throw new Error('Audio frame too large');
    message = JSON.parse(line);
    if (message.method === 'start') {
      if (active) throw new Error('Recording already active');
      if (!Number.isInteger(message.sampleRate) || message.sampleRate < 8000 || message.sampleRate > 96000) throw new Error('Invalid sample rate');
      active = { id: message.sessionId, stream: recognizer.createStream(), rate: message.sampleRate, lastText: '', samples: 0 };
    } else {
      if (!active || message.sessionId !== active.id) throw new Error('Recording expired');
      if (message.method === 'audio') {
        const bytes = Buffer.from(message.audio, 'base64');
        if (!bytes.length || bytes.length % 4 || bytes.length > active.rate * 4 / 2) throw new Error('Invalid audio frame');
        const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        if (!samples.every(Number.isFinite)) throw new Error('Invalid audio samples');
        active.samples += samples.length;
        if (active.samples > active.rate * 600) throw new Error('Recording limit reached');
        active.stream.acceptWaveform({ sampleRate: active.rate, samples });
        decode();
        if (recognizer.isEndpoint(active.stream)) { publish(true); recognizer.reset(active.stream); }
        else publish(false);
      } else if (message.method === 'stop') {
        active.stream.acceptWaveform({ sampleRate: active.rate, samples: new Float32Array(Math.ceil(active.rate * 0.6)) });
        active.stream.inputFinished(); decode(); publish(true); active = null;
      } else if (message.method === 'cancel') { active = null; }
      else throw new Error('Unknown operation');
    }
    emit({ requestId: message.requestId, ok: true });
  } catch (error) {
    active = null;
    emit({ requestId: message?.requestId, ok: false, error: error.message });
  }
});
lines.on('close', () => process.exit(0));
process.on('uncaughtException', () => process.exit(1));
emit({ type: 'ready', loadMs: Math.round(performance.now() - started) });
