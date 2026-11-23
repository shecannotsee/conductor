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
  const progressUpdates = [];
  const controller = new Proxy({
    conversations: [conversation], runtimeStore: { ensure: () => runtime },
    assistantBufferByRunner: new Map(), roundIndexByRunner: new Map(), userMessageByRunner: new Map(),
    _ensureMeta: () => ({}), _pendingQueueSize: () => 0,
    _appendWorkflowAssistantProgress: (...args) => progressUpdates.push(args),
    _removeLastStructuredEventIf: () => false, _removeLastWorkflowItemIf: () => false,
    notifyConversationResult: async () => ({ skipped: true }),
  }, { get: (obj, key) => key in obj ? obj[key] : () => {} });
  bindChatRunnerEvents(controller, { targetId: 'test', runner, userText: 'test' });
  return { runner, conversation, progressUpdates, controller };
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

test('live commentary stays visible in chat and the original runtime workflow', async () => {
  const { runner, conversation, progressUpdates } = setup();
  message(runner, 'progress', 'commentary', 'Checking project files');
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(conversation.messages[0].execution.steps[0].text, 'Checking project files');
  assert.equal(conversation.messages[0].execution.status, 'running');
  assert.equal(progressUpdates[0][2], 'Checking project files');
  message(runner, 'result', 'final_answer', 'Done');
  runner.emit('finished', { exitCode: 0 });
  assert.equal(conversation.messages[0].text, 'Done');
});

const { chatMethods } = require('../app/main/app_controller/methods_chat');
function insertionSetup() {
  const result = setup();
  result.controller.runners = new Map([['test', result.runner]]);
  result.controller.stepIndexByRunner = new Map();
  result.controller._resolveConversationProvider = () => 'codex';
  result.controller.snapshot = () => ({});
  return result;
}
test('inserted instructions retain order even with pending stream flush and early steer response', async () => {
  const { runner, conversation, controller } = insertionSetup();
  message(runner, 'before', 'commentary', 'Before insertion');
  let count = 0;
  runner.steer = async () => {
    count += 1;
    message(runner, `after-${count}`, 'commentary', `After insertion ${count}`);
    await new Promise(resolve => setTimeout(resolve, 160));
  };
  assert.equal((await chatMethods.insertMessage.call(controller, { conversationId: 'test', text: 'Change direction' })).inserted, true);
  assert.equal((await chatMethods.insertMessage.call(controller, { conversationId: 'test', text: 'Another change' })).inserted, true);
  // A late update belongs to its original position, never to the latest instruction.
  runner._handleNotification('item/completed', { turnId: 'turn', item: { id: 'before', type: 'agentMessage', phase: 'commentary', text: 'Before insertion updated' } });
  message(runner, 'final', 'final_answer', 'Done after changes');
  runner.emit('finished', { exitCode: 0 });
  assert.deepEqual(conversation.messages.map(item => item.role), ['assistant', 'user', 'assistant', 'user', 'assistant']);
  assert.equal(conversation.messages[0].execution.steps[0].text, 'Before insertion updated');
  assert.equal(conversation.messages[2].execution.steps[0].text, 'After insertion 1');
  assert.equal(conversation.messages[4].execution.steps[0].text, 'After insertion 2');
  assert.equal(conversation.messages[4].text, 'Done after changes');
});
test('failed insertion removes unaccepted user text and allows later insertion', async () => {
  const { runner, conversation, controller } = insertionSetup();
  message(runner, 'before', 'commentary', 'Still working');
  runner.steer = async () => { throw new Error('Rejected'); };
  assert.match((await chatMethods.insertMessage.call(controller, { conversationId: 'test', text: 'Rejected input' })).error, /Rejected/);
  assert.equal(conversation.messages.some(item => item.role === 'user'), false);
  assert.equal(runner.insertingMessage, false);
  runner.steer = async () => {};
  assert.equal((await chatMethods.insertMessage.call(controller, { conversationId: 'test', text: 'Accepted' })).inserted, true);
  message(runner, 'final', 'final_answer', 'Done');
  runner.emit('finished', { exitCode: 0 });
  assert.deepEqual(conversation.messages.map(item => item.role), ['assistant', 'user', 'assistant']);
});

test('active stage transfers to a completed message and final stays pending until complete', async () => {
  const { runner, conversation } = setup();
  runner._handleNotification('item/started', { turnId: 'turn', item: { id: 'stage', type: 'agentMessage', phase: 'commentary', text: '' } });
  runner._handleNotification('item/agentMessage/delta', { turnId: 'turn', itemId: 'stage', delta: 'Working on stage' });
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.equal(conversation.messages[0].execution.activeText, 'Working on stage');
  assert.equal(conversation.messages[0].execution.steps[0].completed, false);
  runner._handleNotification('item/completed', { turnId: 'turn', item: { id: 'stage', type: 'agentMessage', phase: 'commentary', text: 'Working on stage' } });
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.equal(conversation.messages[0].execution.activeText, '');
  assert.equal(conversation.messages[0].execution.steps[0].completed, true);
  runner._handleNotification('item/started', { turnId: 'turn', item: { id: 'reply', type: 'agentMessage', phase: 'final_answer', text: '' } });
  runner._handleNotification('item/agentMessage/delta', { turnId: 'turn', itemId: 'reply', delta: 'Done' });
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.equal(conversation.messages[0].text, '');
  assert.equal(conversation.messages[0].execution.activeText, 'Done');
  runner._handleNotification('item/completed', { turnId: 'turn', item: { id: 'reply', type: 'agentMessage', phase: 'final_answer', text: 'Done' } });
  runner.emit('finished', { exitCode: 0 });
  assert.equal(conversation.messages[0].text, 'Done');
  assert.equal(conversation.messages[0].execution.activeText, '');
});
