const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { StateStore } = require('../app/main/state_store');
const { JsonAppStateStorage } = require('../app/main/storage');
const { historyLoaded, loadHistory, conversationCopy } = require('../app/main/conversation_history');
const { findSessionFile } = require('../app/main/session_file_locator');

test('legacy migration preserves more than 2000 messages, lazy loading, identity and coalesced saves', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-scale-'));
  const statePath = path.join(root, 'state.json');
  const driver = new StateStore(statePath, path.join(root, 'secrets.json'));
  const storage = new JsonAppStateStorage({ driver });
  try {
    const conversations = Array.from({ length: 1000 }, (_, i) => ({
      id: crypto.randomUUID(), title: `会话 ${i}`, workdir: root, createdAt: i + 1, updatedAt: i + 1,
      messages: Array.from({ length: i === 0 ? 2101 : 20 }, (_, j) => ({ role: 'assistant', text: `${i}-${j}: ` + '正文'.repeat(100), model: 'model-a', reasoningEffort: 'high' })),
    }));
    fs.writeFileSync(statePath, JSON.stringify({ conversations, activeConversationId: conversations[0].id, workdir: root }));
    const state = driver.load();
    const started = performance.now();
    storage.saveState(state);
    await storage.flush();
    const migratedMs = performance.now() - started;
    assert.ok(fs.existsSync(statePath + '.before-split.bak'));
    const reloaded = driver.load();
    assert.equal(reloaded.conversations.length, 1000);
    assert.ok(reloaded.conversations.every(c => !historyLoaded(c)));
    const small = reloaded.conversations.map(c => conversationCopy(c));
    assert.ok(JSON.stringify(small).length < 1000000);
    assert.ok(reloaded.conversations.every(c => !historyLoaded(c)));
    await loadHistory(reloaded.conversations[0]);
    assert.equal(reloaded.conversations[0].messages.length, 2101);
    assert.equal(reloaded.conversations[0].messages[0].reasoningEffort, 'high');
    const untouchedFile = JSON.parse(fs.readFileSync(statePath)).conversations[1].messagesFile;
    const unchangedTime = fs.statSync(path.join(statePath + '.messages', untouchedFile)).mtimeMs;
    for (let i = 0; i < 10; i++) {
      reloaded.conversations[0].messages[0].text = `latest ${i}`;
      storage.saveState(reloaded);
    }
    await storage.flush();
    assert.equal(driver.load().conversations[0].messages[0].text, 'latest 9');
    assert.equal(fs.statSync(path.join(statePath + '.messages', untouchedFile)).mtimeMs, unchangedTime);
    assert.equal(fs.readFileSync(statePath + '.before-split.bak', 'utf8').includes('latest 9'), false);
    assert.ok(historyLoaded(state.conversations[0]));
    assert.equal(historyLoaded(state.conversations[1]), false);
    console.log(`1000 conversations: first migration ${migratedMs.toFixed(0)}ms; summary ${(JSON.stringify(small).length / 1024).toFixed(0)} KiB`);
    // Corruption must surface, never turn a damaged history into an empty conversation.
    const cold = driver.load().conversations[1];
    fs.writeFileSync(path.join(statePath + '.messages', untouchedFile), '{broken');
    await assert.rejects(loadHistory(cold));
  } finally {
    await storage.worker?.terminate();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('session locator resolves nested and archived records and invalidates stale cache', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-locator-'));
  try {
    const id = crypto.randomUUID();
    const live = path.join(root, 'sessions', '2026', '11', '13');
    const archive = path.join(root, 'archived_sessions');
    fs.mkdirSync(live, { recursive: true }); fs.mkdirSync(archive);
    const name = `rollout-2026-11-13-${id}.jsonl`;
    const first = path.join(live, name);
    fs.writeFileSync(first, '{}');
    const roots = [path.join(root, 'sessions'), archive];
    assert.equal(await findSessionFile(id, roots), first);
    const moved = path.join(archive, name);
    fs.renameSync(first, moved);
    assert.equal(await findSessionFile(id, roots), moved);
    const imported = path.join(root, 'renamed-record.jsonl');
    fs.writeFileSync(imported, JSON.stringify({ type: 'session_meta', payload: { id, source: 'cli' } }) + '\n');
    assert.equal(await findSessionFile(id, roots, imported), imported);
    fs.writeFileSync(imported, JSON.stringify({ type: 'session_meta', payload: { id, source: 'conductor' } }) + '\n');
    assert.equal(await findSessionFile(id, roots, imported), moved);
    await assert.rejects(findSessionFile('../auth.json', roots));
    await assert.rejects(findSessionFile(crypto.randomUUID(), roots));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('background save failure is observable and retry preserves unsaved changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-save-failure-'));
  const parent = path.join(root, 'blocked');
  fs.writeFileSync(parent, 'not a directory');
  const storage = new JsonAppStateStorage({ driver: new StateStore(path.join(parent, 'state.json'), path.join(root, 'secrets.json')) });
  const state = { workdir: root, conversations: [{ id: crypto.randomUUID(), workdir: root, messages: [{ role: 'assistant', text: 'keep me' }] }] };
  try {
    storage.saveState(state);
    await assert.rejects(storage.flush());
    fs.unlinkSync(parent);
    state.conversations[0].messages[0].text = 'retry includes latest edits';
    storage.saveState(state);
    await storage.flush();
    assert.equal(storage.loadState().conversations[0].messages[0].text, 'retry includes latest edits');
  } finally { await storage.worker?.terminate(); fs.rmSync(root, { recursive: true, force: true }); }
});
