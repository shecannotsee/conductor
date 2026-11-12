const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SpeechService } = require('../app/main/speech_service');
function wave(file) {
  const b = fs.readFileSync(file); let offset = 12; let rate = 0; let data;
  while (offset + 8 <= b.length) {
    const name = b.toString('ascii', offset, offset + 4), size = b.readUInt32LE(offset + 4);
    if (name === 'fmt ') { assert.equal(b.readUInt16LE(offset + 8), 1); assert.equal(b.readUInt16LE(offset + 10), 1); rate = b.readUInt32LE(offset + 12); assert.equal(b.readUInt16LE(offset + 22), 16); }
    if (name === 'data') data = b.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  const samples = new Float32Array(data.length / 2); for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  return { rate, samples };
}
(async () => {
  const events = []; const speech = new SpeechService(event => events.push(event));
  try {
    assert.equal(speech.status().available, true);
    const started = performance.now(); const first = await speech.start(16000); const loadMs = performance.now() - started;
    await assert.rejects(speech.start(16000), /已有/);
    await assert.rejects(speech.audio(first.sessionId, new Float32Array([NaN])), /无效/);
    const { rate, samples } = wave(path.join(__dirname, '../.runtime-downloads/speech-test.wav')); assert.equal(rate, 16000);
    const decoding = performance.now();
    for (let offset = 0; offset < samples.length; offset += 1600) await speech.audio(first.sessionId, samples.slice(offset, offset + 1600));
    await speech.finish(first.sessionId);
    assert.ok(events.filter(event => event.type === 'partial').length > 3);
    const text = events.filter(event => event.type === 'segment').map(event => event.text).join('');
    assert.match(text, /昨天/); assert.match(text, /星期三/); assert.match(text, /[。，？！]/);
    const decodeMs = performance.now() - decoding;
    await assert.rejects(speech.audio(first.sessionId, new Float32Array(1600)), /已结束/);
    // A new stream must not inherit the previous transcript; 48k browser capture is resampled natively.
    const second = await speech.start(48000); const before = events.length;
    for (let i = 0; i < 15; i++) await speech.audio(second.sessionId, new Float32Array(4800));
    await speech.finish(second.sessionId); assert.equal(events.slice(before).filter(x => x.type === 'segment').length, 0);
    const third = await speech.start(16000); await speech.audio(third.sessionId, samples.slice(0, 1600)); await speech.finish(third.sessionId, true);
    assert.equal(speech.active, '');
    // Abrupt worker loss rejects requests and a fresh worker can restart.
    speech.child.kill(); await new Promise(resolve => setTimeout(resolve, 250));
    const fourth = await speech.start(16000); await speech.finish(fourth.sessionId, true);
    console.log(JSON.stringify({ ok: true, audioSeconds: samples.length / rate, loadMs: Math.round(loadMs), decodeMs: Math.round(decodeMs), partials: events.filter(x => x.type === 'partial').length, transcript: text }));
  } finally { speech.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
