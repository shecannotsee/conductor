const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { CodexAppServerRunner } = require('../app/main/codex/codex_app_server_runner');
const { bindChatRunnerEvents } = require('../app/main/app_controller/chat_runner_events');
const { parseMessages } = require('../app/main/state_store_codec');
const { StateStore } = require('../app/main/state_store');
const { exportConversationJsonl } = require('../app/main/session_exporter');
const { importSessionJsonl } = require('../app/main/session_importer');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

function setup() {
  const runner = new CodexAppServerRunner({ commandText: 'codex', prompt: 'test', workdir: process.cwd() });
  const conversation = { id: 'test', title: 'Test', messages: [], createdAt: 1, updatedAt: 1 };
  const runtime = {};
  const controller = new Proxy({
    conversations: [conversation], runtimeStore: { ensure: () => runtime },
    assistantBufferByRunner: new Map(), roundIndexByRunner: new Map(), userMessageByRunner: new Map(),
    _ensureMeta: () => ({}), _pendingQueueSize: () => 0,
    _removeLastStructuredEventIf: () => false, _removeLastWorkflowItemIf: () => false,
    notifyConversationResult: async () => ({ skipped: true }),
  }, { get: (obj, key) => key in obj ? obj[key] : () => {} });
  bindChatRunnerEvents(controller, { targetId: 'test', runner, userText: 'test' });
  return { runner, conversation };
}
function message(runner, id, phase, text) {
  runner._handleNotification('item/started', { turnId: 'turn', item: { id, type: 'agentMessage', phase, text: '' } });
  runner._handleNotification('item/agentMessage/delta', { turnId: 'turn', itemId: id, delta: text });
  runner._handleNotification('item/completed', { turnId: 'turn', item: { id, type: 'agentMessage', phase, text } });
}
test('short final is isolated from longer progress, duplicate completion is idempotent', () => {
  const { runner, conversation } = setup();
  message(runner, 'progress-1', 'commentary', '正在检查项目配置和相关文件，准备验证修改。');
  message(runner, 'progress-2', 'commentary', '验证完成。');
  message(runner, 'final', 'final_answer', '已修复。');
  runner._handleNotification('item/completed', { turnId: 'turn', item: { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '已修复。' } });
  runner.emit('finished', { exitCode: 0, assistantText: 'must not leak concatenated legacy buffer' });
  assert.equal(conversation.messages.length, 1);
  const reply = conversation.messages[0];
  assert.equal(reply.text, '已修复。');
  assert.equal(reply.execution.steps.length, 2);
  assert.equal(reply.execution.status, 'completed');
  assert.equal(reply.execution.hasFinal, true);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-phases-'));
  try {
    const store = new StateStore(path.join(temp, 'state.json'), path.join(temp, 'secrets.json'));
    store.save({ conversations: [conversation], activeConversationId: 'test' });
    assert.deepEqual(store.load().conversations[0].messages[0].execution, reply.execution);
    const output = path.join(temp, 'export.jsonl');
    exportConversationJsonl(output, conversation);
    assert.deepEqual(importSessionJsonl(output).messages[0].execution, reply.execution);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('missing phase remains visible; progress-only interruption survives normalization', () => {
  const { runner, conversation } = setup();
  message(runner, 'unknown', undefined, '这是未标记的内容，需要保留。');
  runner.emit('finished', { exitCode: 0 });
  assert.equal(conversation.messages[0].text, '这是未标记的内容，需要保留。');
  assert.equal(conversation.messages[0].execution.steps.length, 0);
  const other = setup();
  message(other.runner, 'progress', 'commentary', '请补充文件位置。');
  other.runner.stopped = true;
  other.runner.emit('finished', { exitCode: 1 });
  const normalized = parseMessages(other.conversation.messages);
  assert.equal(normalized[0].text, '');
  assert.equal(normalized[0].execution.status, 'interrupted');
  assert.equal(normalized[0].execution.steps[0].text, '请补充文件位置。');
  assert.deepEqual(parseMessages([{ role: 'assistant', text: '旧回复' }]), [{ role: 'assistant', text: '旧回复' }]);
});
test('phase arriving only on completion reclassifies the same item without duplication', () => {
  const { runner, conversation } = setup();
  runner._handleNotification('item/agentMessage/delta', { turnId: 'turn', itemId: 'late', delta: '阶段更新' });
  runner._handleNotification('item/completed', { turnId: 'turn', item: { id: 'late', type: 'agentMessage', phase: 'commentary', text: '阶段更新' } });
  runner.emit('finished', { exitCode: 1 });
  assert.equal(conversation.messages[0].text, '');
  assert.equal(conversation.messages[0].execution.steps.length, 1);
  assert.equal(conversation.messages[0].execution.status, 'failed');
});
