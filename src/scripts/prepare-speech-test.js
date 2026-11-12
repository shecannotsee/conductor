const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
(async () => {
  const file = path.resolve(__dirname, '../.runtime-downloads/speech-test.wav');
  const sha = "7d93384ca14702cc584a7a33fe2fed92e89e708549161cb12ea38c916882103b";
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  if (fs.existsSync(file) && hash(fs.readFileSync(file)) === sha) return;
  const result = await fetch('https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/8e40c43232a1c5c66c82111efc5820d3accca11b/test_wavs/0.wav');
  if (!result.ok) throw new Error(`HTTP ${result.status}`);
  const bytes = Buffer.from(await result.arrayBuffer()); if (hash(bytes) !== sha) throw new Error('Test fixture checksum mismatch');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
