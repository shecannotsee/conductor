const fs = require('node:fs/promises');
const path = require('node:path');
const cache = new Map();
// Search only session directories, never configuration/key files or symlink targets.
async function findSessionFile(sessionId, roots, importedFile = '') {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId || '')) throw new Error('此会话尚未生成会话文件。');
  if (importedFile && path.extname(importedFile).toLowerCase() === '.jsonl') {
    let handle;
    try {
      handle = await fs.open(importedFile, 'r');
      const buffer = Buffer.alloc(65536);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const first = buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0];
      const meta = JSON.parse(first);
      if (meta.type === 'session_meta' && meta.payload?.id === sessionId
        && meta.payload?.source !== 'conductor' && meta.payload?.originator !== 'conductor') return importedFile;
    } catch { /* Fall back to the known Codex homes if the imported file moved. */ }
    finally { await handle?.close(); }
  }
  const key = JSON.stringify([sessionId, roots]);
  const previous = cache.get(key);
  if (previous && await fs.stat(previous).then(s => s.isFile(), () => false)) return previous;
  for (const root of roots) {
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      let entries;
      try { entries = await fs.readdir(queue[i], { withFileTypes: true }); }
      catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue; throw error; }
      for (const entry of entries) {
        const file = path.join(queue[i], entry.name);
        if (entry.isDirectory()) queue.push(file);
        else if (entry.isFile() && entry.name.endsWith(`-${sessionId}.jsonl`)) {
          if (cache.size >= 256) cache.delete(cache.keys().next().value);
          cache.set(key, file);
          return file;
        }
      }
    }
  }
  throw new Error('未找到会话文件。记录可能尚未写入、已移动或已删除。');
}
module.exports = { findSessionFile };
