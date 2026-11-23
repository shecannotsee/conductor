const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-layout-'));
  const data = path.join(temp, 'ConductorInstalled');
  fs.mkdirSync(data, { recursive: true });
  const conversations = Array.from({ length: 300 }, (_, i) => ({
    id: `layout-${i}`, title: `设计讨论 ${i} · 输入区与紧凑会话列表`,
    createdAt: 1000 - i, updatedAt: 1000 - i, provider: 'codex',
    messages: [{ role: 'user', text: '保留清晰的层级，让聊天更专注。', createdAt: 1000 - i }],
  }));
  fs.writeFileSync(path.join(data, 'state.electron.json'), JSON.stringify({ conversations, activeConversationId: 'layout-0' }));
  let app;
  try {
    const env = { ...process.env, APPDATA: temp, LOCALAPPDATA: path.join(temp, 'local') };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: process.argv[2] || require('electron'), args: process.argv[2] ? [] : ['.'], cwd: path.resolve(__dirname, '..'), env });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('.conversation-item');
    if (process.platform === 'win32') {
      assert.ok(await page.evaluate(() => navigator.windowControlsOverlay?.visible), 'Native window controls overlay must remain visible');
    }
    await page.evaluate(() => document.querySelector('#codex-settings-dialog')?.close());
    // Exercise the real context-menu click with browser clipboard unavailable.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('No browser clipboard')) } });
      const node = document.createElement('p');
      node.id = 'clipboard-test-selection';
      node.style.whiteSpace = 'pre-wrap';
      node.textContent = '跨应用复制验证 · Conductor\n第二行 text 123';
      document.querySelector('#chat-view').appendChild(node);
      const range = document.createRange(); range.selectNodeContents(node);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 500, clientY: 250 }));
    });
    await page.locator('#ctx-copy-selection').click();
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText('clipboard')), '跨应用复制验证 · Conductor\n第二行 text 123');
    await page.evaluate(() => document.querySelector('#clipboard-test-selection').remove());
    // A stream update between mouse-down and mouse-up must not replace the clicked row.
    const target = page.locator('[data-id="layout-1"] .conversation-title-text');
    const targetBox = await target.boundingBox();
    await page.mouse.move(targetBox.x + 10, targetBox.y + 5);
    await page.mouse.down();
    await page.evaluate(() => { window.__pressedRow = document.querySelector('[data-id="layout-1"]'); });
    await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      for (const id of ['layout-0', 'layout-1']) {
        wc.send('app:event', { type: 'runner-state', conversationId: id, running: true });
        wc.send('app:event', { type: 'conversation-updated', conversation: {
          id, title: `正在工作 ${id}`, provider: 'codex', createdAt: 1000, updatedAt: Date.now() / 1000,
          messages: [{ role: 'assistant', text: '任务正在执行，实时更新中。' }],
        } });
      }
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.evaluate(() => window.__pressedRow.isConnected), 'Streaming must preserve the row being clicked');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('[data-id="layout-1"]')?.classList.contains('active'));
    for (const theme of ['light', 'dark']) {
      for (const width of [1460, 1100]) {
        await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 820), width);
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        const bounds = await page.evaluate(() => {
          const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
          return { row: rect('.conversation-item'), input: rect('#input-box'), profile: rect('.codex-profile-bar'), speech: rect('#btn-speech'), send: rect('#btn-send'), clock: rect('#current-time-chip'), top: rect('.window-titlebar'), footer: rect('.composer-footer'), height: innerHeight, width: innerWidth };
        });
        assert.equal(bounds.row.height, 62);
        assert.equal(bounds.top.y, 0);
        assert.ok(bounds.clock.bottom <= bounds.top.bottom);
        assert.equal(await page.locator('.window-titlebar').evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region')), 'drag');
        assert.ok(bounds.profile.y >= bounds.input.bottom);
        assert.ok(bounds.speech.y >= bounds.input.bottom);
        assert.ok(bounds.send.right <= bounds.width);
        assert.ok(bounds.footer.bottom <= bounds.height);
        assert.equal(await page.evaluate(() => document.querySelector('#chat-title').nextElementSibling.id), 'composer-workdir');
        assert.ok(await page.locator('#composer-workdir-value').getAttribute('data-open-path'));
        assert.equal(await page.locator('#btn-send-goal').count(), 0);
        const directory = page.locator('#composer-workdir-value');
        assert.equal(await directory.textContent(), path.basename(await directory.getAttribute('data-copy-text')));
        assert.equal(await directory.getAttribute('title'), await directory.getAttribute('data-copy-text'));
        assert.ok(Math.abs(bounds.clock.x + bounds.clock.width / 2 - bounds.top.x - bounds.top.width / 2) < 2);
        await page.screenshot({ path: path.resolve(__dirname, `../../dist/windows/layout-0.5.4-${theme}-${width}.png`) });
      }
    }
    await page.locator('#conversation-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForSelector('[data-id="layout-299"]');
    await page.locator('[data-id="layout-299"]').click();
    await page.waitForFunction(() => document.querySelector('#chat-title-text').textContent.includes('299'));
    assert.deepEqual(errors, []);
    console.log('PASS: native titlebar overlay, system clipboard, click during concurrent stream updates, compact 300-row scrolling, final-row selection, light/dark and minimum window layout.');
  } finally {
    if (app) await app.close();
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
