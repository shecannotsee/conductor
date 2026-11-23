const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-execution-ui-'));
  const data = path.join(temp, 'ConductorInstalled'); fs.mkdirSync(data, { recursive: true });
  const execution = { id: 'task-1', status: 'completed', hasFinal: true, startedAt: 100, completedAt: 225,
    steps: [{ id: 'one', text: '正在检查项目配置。' }, { id: 'two', text: '测试通过，开始生成安装包。' }] };
  const reply = { model: 'test-model', reasoningEffort: 'high', role: 'assistant', text: '已完成修复。\n\n[查看文件](https://example.com)', execution, createdAt: 225 };
  const conv = { id: 'sample', title: '过程与结果展示', messages: [{ role: 'user', text: '请修复这个问题。' }, reply] };
  fs.writeFileSync(path.join(data, 'state.electron.json'), JSON.stringify({ conversations: [conv], activeConversationId: conv.id }));
  const env = { ...process.env, APPDATA: temp, LOCALAPPDATA: path.join(temp, 'local') }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: process.argv[2] || require('electron'), args: process.argv[2] ? [] : ['.'], cwd: path.resolve(__dirname, '..'), env });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.execution-message');
    await page.evaluate(() => document.querySelector('#codex-settings-dialog')?.close());
    assert.equal(await page.locator('.execution-message').count(), 2);
    assert.ok((await page.locator('.execution-message .msg-role').first().innerText()).includes('test-model · high'));
    assert.equal(await page.locator('[data-reply-copy]').count(), 0);
    assert.equal(await page.locator('.execution-phase-label').count(), 0);
    assert.equal(await page.locator('.execution-step .msg-time').count(), 2);
    assert.match(await page.locator('.execution-step .msg-time').first().innerText(), /\d{2}:\d{2}:\d{2}$/);
    assert.equal(await page.getByText('最终答复', { exact: true }).count(), 0);
    assert.equal(await page.locator('.execution-message details').count(), 0);
    assert.ok(await page.locator('.execution-step').first().isVisible());
    assert.ok((await page.locator('.msg-assistant .msg-expanded').innerText()).includes('已完成修复'));
    const publish = async (message, running) => app.evaluate(({ BrowserWindow }, { message, running }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.send('app:event', { type: 'runner-state', conversationId: 'sample', running });
      wc.send('app:event', { type: 'conversation-updated', conversation: { id: 'sample', title: '过程与结果展示', messages: [{ role: 'user', text: '请修复这个问题。' }, message] } });
    }, { message, running });
    const progress = { ...reply, text: '', execution: { ...execution, status: 'running', completedAt: 0, hasFinal: false } };
    await publish(progress, true);
    await page.waitForSelector('.execution-message.is-running');
    assert.equal(await page.locator('.execution-message').count(), 2);
    await publish({ ...progress, execution: { ...progress.execution, steps: [...execution.steps, { id: 'three', text: '安装包验证通过。' }] } }, true);
    await page.waitForFunction(() => document.querySelectorAll('.execution-message').length === 3);
    assert.ok((await page.locator('.execution-step').nth(2).innerText()).includes('安装包验证通过'));
    assert.ok(await page.locator('.chat-transient-stack .msg-running-step-panel').isVisible());
    const pendingStep = { id: 'pending', text: '正在核对新的阶段内容', completed: false };
    await publish({ ...progress, execution: { ...progress.execution, activeText: pendingStep.text, steps: [...execution.steps, pendingStep] } }, true);
    await page.waitForFunction(() => document.querySelector('.chat-transient-stack').textContent.includes('正在核对新的阶段内容'));
    assert.equal(await page.locator('.execution-message').count(), 2);
    await page.waitForFunction(text => document.querySelector('.conversation-preview')?.textContent.includes(text), pendingStep.text);
    assert.ok(!(await page.locator('.chat-history-list').innerText()).includes(pendingStep.text));
    await publish({ ...progress, execution: { ...progress.execution, activeText: '', steps: [...execution.steps, { ...pendingStep, completed: true }] } }, true);
    await page.waitForFunction(() => document.querySelectorAll('.execution-message').length === 3);
    assert.ok(!(await page.locator('.chat-transient-stack').innerText()).includes(pendingStep.text));
    await publish(reply, false);
    await page.waitForFunction(() => document.querySelectorAll('.execution-message').length === 2);
    await page.screenshot({ path: path.resolve(__dirname, '../../dist/windows/execution-result.png') });
    const interrupted = { role: 'assistant', text: '', execution: { ...execution, id: 'interrupted', hasFinal: false, status: 'interrupted', steps: [{ id: 'question', text: '请提供目标文件的位置。' }] } };
    await publish(interrupted, false);
    await page.waitForFunction(() => document.querySelector('.execution-status')?.textContent.includes('已中断'));
    assert.ok((await page.locator('.execution-step').innerText()).includes('请提供'));
    await page.reload();
    await page.waitForSelector('.execution-message');
    assert.equal(await page.locator('.execution-message').count(), 2);
    assert.ok((await page.locator('.msg-assistant .msg-expanded').innerText()).includes('已完成修复'));
    assert.deepEqual(errors, []);
    console.log('PASS: individual phase bubbles, live updates, no copy buttons or final label, original running steps, interrupted question visibility, reloaded history.');
  } finally {
    if (app) await app.close();
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
