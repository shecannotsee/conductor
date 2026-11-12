import { codexdesk } from './codexdesk.js';
import { state } from './state_i18n.js';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dialog = element<HTMLDialogElement>('codex-settings-dialog');
const form = element<HTMLFormElement>('codex-settings-form');
const base = element<HTMLInputElement>('codex-base-url');
const key = element<HTMLInputElement>('codex-api-key');
const model = element<HTMLInputElement>('codex-model');
const effort = element<HTMLSelectElement>('codex-effort');
const status = element('codex-settings-status');
const editor = element<HTMLSelectElement>('codex-profile-editor');
const profileName = element<HTMLInputElement>('codex-profile-name');
const makeDefault = element<HTMLInputElement>('codex-profile-default');
const conversationSelect = element<HTMLSelectElement>('conversation-codex-profile');
let profileData: any = { profiles: [] };
let editingId = 'default';
const labels = { low: '低 · Low', medium: '中 · Medium', high: '高 · High', xhigh: '极高 · Extra High', max: 'Max', ultra: 'Ultra' };
let models: any[] = [];
let busy = false;
function setEfforts(preferred = effort.value || 'medium') {
  const selected = models.find(item => item.model === model.value.trim());
  const choices = selected?.efforts?.length ? selected.efforts : Object.keys(labels);
  effort.replaceChildren(...choices.map(value => { const option = document.createElement('option'); option.value = value; option.textContent = labels[value] || value; return option; }));
  effort.value = choices.includes(preferred) ? preferred : (selected?.defaultEffort || choices[0]);
  element('codex-model-hint').textContent = selected
    ? '强度来自内置 Codex 的能力信息；自定义 API 是否支持此模型仍需测试。'
    : '自定义模型：请按平台支持情况选择强度，并测试连接。';
}
function render(value) {
  base.value = value.baseUrl; model.value = value.model; key.value = ''; setEfforts(value.effort);
  key.placeholder = value.hasApiKey ? '已保存；留空保留，输入新 Key 替换' : '填写 API Key';
  element('codex-key-state').textContent = value.hasApiKey ? '已保存（不回显）' : '尚未配置';
}
async function run(action) {
  if (busy) return;
  busy = true; form.querySelectorAll<HTMLInputElement>('button, input, select').forEach(button => button.disabled = true);
  status.textContent = '正在处理…';
  try { await action(); } catch (error) { status.textContent = error.message || '操作失败，请重试。'; }
  finally { busy = false; form.querySelectorAll<HTMLInputElement>('button, input, select').forEach(button => button.disabled = false); }
}
function checked(result) { if (!result.ok) throw new Error(result.error || '操作失败'); return result.value; }
async function save(clearApiKey = false) {
  const value = checked(await codexdesk.saveCodexProfile({ id: editingId, name: profileName.value, makeDefault: makeDefault.checked, baseUrl: base.value, model: model.value, effort: effort.value, apiKey: key.value, clearApiKey }));
  editingId = value.id; render(value); await refresh(); return value;
}
function option(value, label) { const item = document.createElement('option'); item.value = value; item.textContent = label; return item; }
async function refresh() {
  const conversationId = state.activeConversationId;
  const data = checked(await codexdesk.listCodexProfiles(conversationId));
  if (conversationId !== state.activeConversationId) return;
  profileData = data;
  conversationSelect.replaceChildren(...data.profiles.map(item => option(item.id, `${item.name} · ${item.model || '未配置'} · ${item.effort}`)));
  conversationSelect.value = data.selectedId;
  conversationSelect.disabled = !conversationId;
  editor.replaceChildren(...data.profiles.map(item => option(item.id, item.name)));
  editor.value = editingId;
}
function edit(id) {
  editingId = id; editor.value = id;
  const value = profileData.profiles.find(item => item.id === id);
  profileName.value = value?.name || ''; makeDefault.checked = id === profileData.defaultId;
  render(value || { baseUrl: 'https://magic666.top/v1', model: '', effort: 'medium', hasApiKey: false });
  status.textContent = '';
}
async function open() {
  if (!dialog.open) dialog.showModal();
  await run(async () => { await refresh(); edit(profileData.selectedId); });
}
element('open-codex-settings').addEventListener('click', () => { void open(); });
element('codex-settings-close').addEventListener('click', () => { key.value = ''; dialog.close(); });
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else key.value = ''; });
model.addEventListener('input', () => setEfforts());
form.addEventListener('submit', event => { event.preventDefault(); void run(async () => { await save(); dialog.close(); }); });
element('codex-test').addEventListener('click', () => { if (!form.reportValidity()) return; void run(async () => { await save(); status.textContent = '正在测试连接（最多 60 秒）…'; checked(await codexdesk.testCodexConnection(editingId)); dialog.close(); }); });
element('codex-clear-key').addEventListener('click', () => { if (!confirm('清除此配置保存的 API Key？')) return; void run(async () => { await save(true); status.textContent = '已清除 API Key。'; }); });
element('codex-refresh-models').addEventListener('click', () => { void run(async () => {
  models = checked(await codexdesk.listCodexModels(editingId || 'default'));
  element('codex-model-options').replaceChildren(...models.map(item => { const option = document.createElement('option'); option.value = item.model; option.label = item.name; return option; }));
  setEfforts(); status.textContent = `已读取 ${models.length} 个候选模型；也可手动输入平台提供的模型。`;
}); });
setEfforts();
element('manage-codex-profiles').addEventListener('click', () => { void open(); });
editor.addEventListener('change', () => edit(editor.value));
element('codex-profile-new').addEventListener('click', () => { edit(''); editor.prepend(option('', '新增配置')); editor.value = ''; profileName.focus(); });
element('codex-profile-delete').addEventListener('click', () => {
  if (!editingId || !confirm('删除此配置及其保存的 Key？')) return;
  void run(async () => { checked(await codexdesk.deleteCodexProfile(editingId)); await refresh(); edit(profileData.defaultId); });
});
conversationSelect.addEventListener('change', async () => {
  const id = state.activeConversationId; const selected = conversationSelect.value;
  if (!confirm('将此对话切换到所选配置？会开始新的 Codex 原生会话，本地聊天记录保留。')) { await refresh(); return; }
  conversationSelect.disabled = true;
  try { checked(await codexdesk.bindCodexProfile(id, selected)); element('codex-profile-status').textContent = '配置已切换'; }
  catch (error) { element('codex-profile-status').textContent = error.message; }
  finally { await refresh(); }
});
let lastConversation = '';
setInterval(() => { if (state.activeConversationId !== lastConversation) { lastConversation = state.activeConversationId; element('codex-profile-status').textContent = ''; void refresh().catch(() => {}); } }, 500);
void refresh().then(() => { if (!profileData.profiles.find(item => item.id === profileData.defaultId)?.configured) void open(); }).catch(() => { void open(); });
