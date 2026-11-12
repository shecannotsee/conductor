const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const assert = require('node:assert/strict');
(async () => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-speech-ui-')); let app;
 try {
  const env = { ...process.env, APPDATA: temp, LOCALAPPDATA: path.join(temp, 'local') }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.argv[2] || require('electron');
  app = await electron.launch({ executablePath, timeout: 45000, cwd: path.resolve(__dirname, '..'), env,
    args: [...(process.argv[2] ? [] : ['.']), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve(__dirname, '../.runtime-downloads/speech-test.wav')}`] });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#codex-settings-dialog[open]'); await page.click('#codex-settings-close');
  await page.evaluate(() => document.querySelector('#btn-new-conv').click()); await page.click('#create-conversation-confirm');
  await page.fill('#input-box', '原来的草稿：');
  await page.click('#btn-speech');
  await page.waitForFunction(() => document.querySelector('#btn-speech').getAttribute('aria-pressed') === 'true', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#speech-partial').textContent.length > 0, { timeout: 20000 });
  await page.waitForTimeout(11000);
  await page.click('#btn-speech');
  await page.waitForFunction(() => document.querySelector('#speech-status').textContent.includes('手动发送'), { timeout: 20000 });
  const text = await page.inputValue('#input-box'); assert.ok(text.startsWith('原来的草稿：')); assert.match(text, /昨天/);
  await page.screenshot({ path: path.resolve(__dirname, '../../dist/windows/speech-input.png') });
  await page.click('#btn-speech'); await page.waitForFunction(() => document.querySelector('#btn-speech').getAttribute('aria-pressed') === 'true');
  await page.click('#btn-speech-cancel'); await page.waitForFunction(() => document.querySelector('#speech-status').textContent.includes('已取消'));
  assert.equal(await page.inputValue('#input-box'), text);
  // Switching conversations cancels the active recording before text can enter the new draft.
  await page.click('#btn-speech'); await page.waitForFunction(() => document.querySelector('#btn-speech').getAttribute('aria-pressed') === 'true');
  await page.evaluate(() => document.querySelector('#btn-new-conv').click()); await page.click('#create-conversation-confirm');
  await page.waitForFunction(() => document.querySelector('#speech-status').textContent.includes('会话已切换'));
  assert.equal(await page.inputValue('#input-box'), '');
  // Cancelling immediately while model/microphone startup is pending must release the session.
  await page.click('#btn-speech'); await page.click('#btn-speech-cancel');
  await page.waitForFunction(() => document.querySelector('#speech-status').textContent.includes('已取消'));
  assert.deepEqual(errors, []);
  console.log('PASS: browser microphone capture -> private native ASR -> live partials -> punctuated composer insertion; original draft preserved; stop/cancel; no renderer errors.');
 } finally { if (app) await app.close(); assert.ok(temp.startsWith(path.join(os.tmpdir(), 'conductor-speech-ui-'))); await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
