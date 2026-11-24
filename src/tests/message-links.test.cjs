const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-links-'));
  const data = path.join(temp, 'ConductorInstalled'); fs.mkdirSync(data, { recursive: true });
  const file = path.join(temp, '安装 包.exe'); fs.writeFileSync(file, 'test');
  const url = 'https://example.com/download?q=hello%20world';
  const text = `[下载安装包](<${file.replaceAll('\\', '/')}>)\n\n[网页](${url})`;
  fs.writeFileSync(path.join(data, 'state.electron.json'), JSON.stringify({ conversations: [{ id: 'links', title: 'Links', messages: [{ role: 'assistant', text }] }], activeConversationId: 'links' }));
  const env = { ...process.env, APPDATA: temp, LOCALAPPDATA: path.join(temp, 'local') }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: process.argv[2] || require('electron'), args: process.argv[2] ? [] : ['.'], cwd: path.resolve(__dirname, '..'), env });
    const page = await app.firstWindow();
    await page.waitForSelector('.md-local-link');
    await page.evaluate(() => document.querySelector('#codex-settings-dialog')?.close());
    await app.evaluate(({ shell, dialog }) => {
      global.linkTest = { paths: [], opened: [], prompts: [], response: 1 };
      shell.showItemInFolder = value => global.linkTest.paths.push(value);
      shell.openExternal = async value => { global.linkTest.opened.push(value); };
      dialog.showMessageBox = async (...args) => { global.linkTest.prompts.push(args.at(-1)); return { response: global.linkTest.response }; };
    });
    await page.locator('.md-local-link').click();
    await page.waitForTimeout(150);
    const paths = await app.evaluate(() => global.linkTest.paths);
    assert.equal(path.normalize(paths[0]), path.normalize(file));
    const web = page.getByRole('link', { name: '网页', exact: true });
    for (const response of [1, 2, 0]) {
      await app.evaluate((_, response) => { global.linkTest.response = response; }, response);
      await web.click();
      await page.waitForTimeout(150);
    }
    const result = await app.evaluate(({ clipboard }) => ({ ...global.linkTest, copied: clipboard.readText() }));
    assert.equal(result.prompts.length, 3);
    assert.deepEqual(result.prompts[0].buttons, ['是', '否', '复制网页链接']);
    assert.equal(result.prompts[0].cancelId, 1);
    assert.deepEqual(result.opened, [url]);
    assert.equal(result.copied, url);
    console.log('PASS: rendered local link reveals file; web confirmation supports yes, no and copy without navigating app.');
  } finally {
    if (app) await app.close();
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
