const { _electron: electron } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-connection-ui-'));
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (!req.url.endsWith('/responses')) { res.writeHead(404); res.end(); return; }
      seen.push({ key: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const item = { id: 'msg_ui', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] };
      const response = { id: 'resp_ui', object: 'response', status: 'in_progress', output: [] };
      for (const [type, data] of [
        ['response.created', { response }],
        ['response.output_item.done', { output_index: 0, item }],
        ['response.completed', { response: { ...response, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }],
      ]) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      res.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let app;
  try {
    const env = { ...process.env, APPDATA: temp, LOCALAPPDATA: path.join(temp, 'local') }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: process.argv[2] || require('electron'), args: process.argv[2] ? [] : ['.'], cwd: path.resolve(__dirname, '..'), env });
    const page = await app.firstWindow();
    await page.waitForSelector('#codex-settings-dialog[open]');
    await page.fill('#codex-base-url', `http://127.0.0.1:${server.address().port}/v1`);
    await page.fill('#codex-model', 'ui-test-model');
    await page.fill('#codex-api-key', 'fake-ui-test-key');
    await page.selectOption('#codex-effort', 'medium');
    await page.click('#codex-test');
    await page.waitForFunction(() => !document.querySelector('#codex-settings-dialog').open, null, { timeout: 70000 });
    assert.ok(seen.length);
    assert.equal(seen[0].key, 'Bearer fake-ui-test-key');
    assert.equal(seen[0].body.model, 'ui-test-model');
    const saved = await page.evaluate(() => window.codexdesk.listCodexProfiles());
    assert.ok(saved.value.profiles[0].hasApiKey);
    assert.equal(await page.inputValue('#codex-api-key'), '');
    console.log('PASS: UI test connection uses entered configuration, persists settings and closes automatically on success.');
  } finally {
    if (app) await app.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
