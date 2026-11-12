const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-scale-ui-'));
  let app;
  try {
    const env = { ...process.env, APPDATA: temp, LOCALAPPDATA: path.join(temp, 'local') }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: path.resolve(__dirname, '..'), env });
    const page = await app.firstWindow();
    await page.waitForSelector('#codex-settings-dialog[open]');
    await page.evaluate(() => document.querySelector('#codex-settings-dialog').close());
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const result = await page.evaluate(async () => {
      const { state, el } = await import('./app/state_i18n.js');
      const { renderConversationList } = await import('./app/conversation_list_renderer.js');
      const { renderChat } = await import('./app/chat_renderer.js');
      state.workspaceMode = 'conversation';
      state.conversations = Array.from({ length: 10000 }, (_, i) => ({ id: `scale-${i}`, title: `Scale ${i}`, provider: 'codex', createdAt: i + 1, updatedAt: i + 1, messages: [{ role: 'assistant', text: 'hello', model: 'model-a', reasoningEffort: 'high' }] }));
      state.activeConversationId = 'scale-9999';
      const start = performance.now(); renderConversationList();
      const renderMs = performance.now() - start;
      const firstRows = el.conversationList.querySelectorAll('.conversation-item').length;
      renderChat(true);
      const label = el.chatView.textContent;
      el.conversationList.scrollTop = el.conversationList.scrollHeight;
      await new Promise(resolve => setTimeout(resolve, 100));
      const lastVisible = !!el.conversationList.querySelector('[data-id="scale-0"]');
      el.sidebarSearchInput.value = 'Scale 4321'; renderConversationList();
      return { renderMs, firstRows, lastVisible, label, filtered: el.conversationList.querySelectorAll('.conversation-item').length };
    });
    assert.ok(result.firstRows < 40); assert.equal(result.lastVisible, true);
    assert.equal(result.filtered, 1); assert.match(result.label, /model-a · high/);
    await page.locator('.conversation-item').click({ button: 'right' });
    assert.equal(await page.locator('#ctx-session-file').textContent(), '会话文件');
    assert.equal(await page.locator('#ctx-session-file').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: 10,000 conversations, bounded DOM, bottom scrolling, search, right-click and model/effort label.', result);
  } finally {
    if (app) await app.close();
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
