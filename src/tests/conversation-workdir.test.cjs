const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runtimeMethods } = require('../app/main/app_controller/methods_runtime');

function controllerFor(root) {
  const first = { id: 'first', workdir: root, updatedAt: 1 };
  const second = { id: 'second', workdir: root, updatedAt: 2 };
  const events = [];
  const controller = {
    conversations: [first, second],
    activeConversationId: first.id,
    workdir: root,
    defaultWorkdir: root,
    runners: new Map(),
    pendingQueueByConversation: new Map(),
    _isConversationRunning: id => controller.runners.has(id),
    _pendingQueueSize: id => controller.pendingQueueByConversation.get(id)?.length || 0,
    _defaultWorkdir: () => controller.defaultWorkdir,
    _appendStructuredEvent: (...args) => events.push(args),
    _syncConversationUpdated: conv => events.push(['conversation-updated', conv.id]),
    _persist: () => events.push(['persist']),
    snapshot: () => ({ conversations: controller.conversations.map(conv => ({ ...conv })), settings: { workdir: controller.defaultWorkdir } }),
  };
  Object.assign(controller, runtimeMethods, {
    _isConversationRunning: id => controller.runners.has(id),
    _pendingQueueSize: id => controller.pendingQueueByConversation.get(id)?.length || 0,
    _defaultWorkdir: () => controller.defaultWorkdir,
    _appendStructuredEvent: (...args) => events.push(args),
    _syncConversationUpdated: conv => events.push(['conversation-updated', conv.id]),
    _persist: () => events.push(['persist']),
    snapshot: () => ({ conversations: controller.conversations.map(conv => ({ ...conv })), settings: { workdir: controller.defaultWorkdir } }),
  });
  return { controller, first, second, events };
}

test('changing a conversation workdir updates only that conversation and persists it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-workdir-'));
  const nextDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-workdir-next-'));
  try {
    const { controller, first, second, events } = controllerFor(root);
    const result = controller.setConversationWorkdir(first.id, nextDirectory);

    assert.equal(first.workdir, path.resolve(nextDirectory));
    assert.equal(second.workdir, root);
    assert.equal(controller.defaultWorkdir, root);
    assert.equal(result.conversations.find(conv => conv.id === first.id).workdir, path.resolve(nextDirectory));
    assert.ok(events.some(item => item[0] === 'persist'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(nextDirectory, { recursive: true, force: true });
  }
});

test('workdir changes are rejected for a running or queued conversation and for invalid paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-workdir-guard-'));
  const nextDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-workdir-guard-next-'));
  try {
    const { controller, first, events } = controllerFor(root);
    controller.runners.set(first.id, {});
    assert.match(controller.setConversationWorkdir(first.id, nextDirectory).error, /任务/);
    controller.runners.clear();
    controller.pendingQueueByConversation.set(first.id, [{}]);
    assert.match(controller.setConversationWorkdir(first.id, nextDirectory).error, /排队/);
    controller.pendingQueueByConversation.clear();
    assert.match(controller.setConversationWorkdir(first.id, path.join(root, 'missing')).error, /不存在/);
    assert.equal(first.workdir, root);
    assert.equal(events.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(nextDirectory, { recursive: true, force: true });
  }
});
