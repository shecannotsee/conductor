const fs = require('node:fs');
const path = require('node:path');
const { parseMessages } = require('./state_store_codec');
const histories = new WeakMap();
function attachHistory(conv, directory, file, preview) {
  if (!/^[a-f0-9]{64}\.json$/.test(file || '')) throw new Error('Invalid conversation history filename');
  const record = { file, path: path.join(directory, file), loaded: false, messages: null, preview: preview || [] };
  histories.set(conv, record);
  Object.defineProperty(conv, 'messages', {
    enumerable: true, configurable: true,
    get() {
      if (!record.loaded) {
        record.messages = parseMessages(JSON.parse(fs.readFileSync(record.path, 'utf8')));
        record.loaded = true;
      }
      return record.messages;
    },
    set(value) { record.messages = value; record.loaded = true; },
  });
}
async function loadHistory(conv) {
  const record = histories.get(conv);
  if (!record || record.loaded) return;
  const messages = parseMessages(JSON.parse(await fs.promises.readFile(record.path, 'utf8')));
  // A runner may have accessed or replaced the messages during the read.
  if (!record.loaded) { record.messages = messages; record.loaded = true; }
}
function historyLoaded(conv) { return !histories.has(conv) || histories.get(conv).loaded; }
function conversationCopy(conv, full = false, persistence = false) {
  const copy: any = {};
  for (const key of Object.keys(conv)) if (key !== 'messages') copy[key] = conv[key];
  const record = histories.get(conv);
  if (persistence && record && !record.loaded) {
    copy.messagesFile = record.file;
    copy.messagePreview = record.preview;
  } else if (full) {
    copy.messages = conv.messages;
  } else {
    const messages = record && !record.loaded ? record.preview : conv.messages;
    const last = messages?.[messages.length - 1];
    copy.messages = last ? [{ role: last.role, text: String(last.text || '').slice(0, 300), createdAt: last.createdAt }] : [];
  }
  return copy;
}
module.exports = { attachHistory, loadHistory, historyLoaded, conversationCopy };
