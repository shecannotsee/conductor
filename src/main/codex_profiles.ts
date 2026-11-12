const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { dataDir, codexHome } = require('./preview_runtime');
const settings = require('./codex_settings');
function load() {
  const file = path.join(dataDir(), 'profiles.json');
  if (!fs.existsSync(file)) return { defaultId: 'default', profiles: [{ id: 'default', name: '默认配置' }], conversations: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function write(data) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const file = path.join(dataDir(), 'profiles.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
function requireProfile(id, data = load()) {
  if (!data.profiles.some(item => item.id === id)) throw new Error('配置不存在，请重新选择。');
  return id;
}
function forConversation(conversationId) {
  const data = load();
  return requireProfile(data.conversations[conversationId] || data.defaultId, data);
}
function list(conversationId = '') {
  const data = load();
  return { defaultId: data.defaultId, selectedId: forConversation(conversationId),
    profiles: data.profiles.map(item => ({ ...item, ...settings.readSettings(item.id) })) };
}
function save(input) {
  const data = load();
  const id = input.id ? requireProfile(input.id, data) : randomUUID();
  const name = String(input.name || '').trim();
  if (!name || name.length > 80) throw new Error('请输入 1–80 字的配置名称。');
  if (data.profiles.some(item => item.name === name && item.id !== id)) throw new Error('配置名称已存在。');
  const value = settings.saveSettings(input, id);
  const item = data.profiles.find(item => item.id === id);
  if (item) item.name = name; else data.profiles.push({ id, name });
  if (input.makeDefault) data.defaultId = id;
  write(data);
  return { ...value, id, name };
}
function bind(conversationId, id) {
  const data = load(); requireProfile(id, data);
  if (!settings.readSettings(id).configured) throw new Error('请先为此配置填写模型和 API Key。');
  data.conversations[conversationId] = id; write(data);
}
function pinExisting(conversations) {
  const data = load();
  const activeIds = new Set(conversations.map(conv => conv.id));
  for (const id of Object.keys(data.conversations)) if (!activeIds.has(id)) delete data.conversations[id];
  for (const conv of conversations) if (!data.conversations[conv.id]) data.conversations[conv.id] = data.defaultId;
  write(data);
}
function remove(id) {
  const data = load(); requireProfile(id, data);
  if (id === 'default' || id === data.defaultId) throw new Error('初始配置和默认配置不能删除。');
  if (Object.values(data.conversations).includes(id)) throw new Error('此配置仍被对话使用，请先切换这些对话。');
  data.profiles = data.profiles.filter(item => item.id !== id); write(data);
  fs.rmSync(codexHome(id), { recursive: true, force: true });
}
module.exports = { list, save, bind, remove, pinExisting, forConversation, requireProfile };
