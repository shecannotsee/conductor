const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-preview-api-'));
  process.env.APPDATA = temp; process.env.OPENAI_API_KEY = 'must-not-be-used';
  const settings = require('../app/main/codex_settings');
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
      if (!req.url.endsWith('/responses')) { res.writeHead(404); res.end(); return; }
      requests.push({ url: req.url, key: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const item = { id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] };
      const response = { id: 'resp_test', object: 'response', created_at: Math.floor(Date.now()/1000), status: 'in_progress', model: 'test-model', output: [] };
      let seq = 0;
      function event(type, data) { res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`); }
      event('response.created', { response });
      event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'OK' });
      event('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: 'OK' });
      event('response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', { response: { ...response, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
      res.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    settings.saveSettings({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', effort: 'high', apiKey: 'fake-integration-key' });
    assert.deepEqual(await settings.testConnection(), { ok: true });
    assert.ok(requests.length > 0);
    for (const request of requests) {
      assert.equal(request.url, '/v1/responses');
      assert.equal(request.key, 'Bearer fake-integration-key');
      assert.equal(request.body.model, 'test-model');
      assert.equal(request.body.reasoning.effort, 'high');
    }
    // Exercise the actual conversation runners, including continuation.
    const workdir = path.join(temp, 'external-project'); fs.mkdirSync(workdir);
    fs.writeFileSync(path.join(workdir, 'project.txt'), 'outside application installation');
    const { CodexRunner } = require('../app/main/codex/codex_runner');
    const { CodexAppServerRunner } = require('../app/main/codex/codex_app_server_runner');
    const commandText = 'codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox';
    async function run(runner) {
      const result = new Promise(resolve => runner.once('finished', resolve));
      runner.run();
      const value = await result; assert.equal(value.exitCode, 0, value.rawOutput);
      assert.match(value.assistantText, /OK/); return value.sessionId;
    }
    const session = await run(new CodexRunner({ commandText, prompt: 'Reply OK', workdir }));
    assert.ok(session);
    await run(new CodexRunner({ commandText, prompt: 'Reply OK again', workdir, sessionId: session }));
    const appSession = await run(new CodexAppServerRunner({ commandText, prompt: 'Reply OK', workdir }));
    assert.ok(appSession);
    await run(new CodexAppServerRunner({ commandText, prompt: 'Reply OK again', workdir, sessionId: appSession, mode: 'resume' }));
    for (const request of requests) {
      assert.equal(request.key, 'Bearer fake-integration-key');
      assert.equal(request.body.model, 'test-model');
      assert.equal(request.body.reasoning.effort, 'high');
    }
    const profiles = require('../app/main/codex_profiles');
    const a = profiles.save({ name: 'Provider A', baseUrl: `http://127.0.0.1:${port}/a`, model: 'model-a', effort: 'high', apiKey: 'fake-a' });
    const b = profiles.save({ name: 'Provider B', baseUrl: `http://127.0.0.1:${port}/b`, model: 'model-b', effort: 'medium', apiKey: 'fake-b' });
    profiles.bind('conversation-a', a.id); profiles.bind('conversation-b', b.id);
    assert.throws(() => profiles.remove(a.id), /对话/);
    assert.ok(!JSON.stringify(profiles.list()).includes('fake-a'));
    const offset = requests.length;
    const conflicting = commandText + ' --model stale-model -c model_reasoning_effort="low"';
    const [sessionA, sessionB] = await Promise.all([
      run(new CodexAppServerRunner({ profileId: profiles.forConversation('conversation-a'), commandText: conflicting, prompt: 'Reply OK A', workdir })),
      run(new CodexRunner({ profileId: profiles.forConversation('conversation-b'), commandText: conflicting, prompt: 'Reply OK B', workdir })),
    ]);
    await Promise.all([
      run(new CodexAppServerRunner({ profileId: a.id, commandText: conflicting, prompt: 'Again A', workdir, sessionId: sessionA, mode: 'resume' })),
      run(new CodexRunner({ profileId: b.id, commandText: conflicting, prompt: 'Again B', workdir, sessionId: sessionB })),
    ]);
    const isolated = requests.slice(offset);
    assert.ok(isolated.some(item => item.url === '/a/responses'));
    assert.ok(isolated.some(item => item.url === '/b/responses'));
    for (const request of isolated) {
      const isA = request.url === '/a/responses';
      assert.equal(request.key, isA ? 'Bearer fake-a' : 'Bearer fake-b');
      assert.equal(request.body.model, isA ? 'model-a' : 'model-b');
      assert.equal(request.body.reasoning.effort, isA ? 'high' : 'medium');
    }
    profiles.save({ ...b, baseUrl: `http://127.0.0.1:${port}/b`, apiKey: '', makeDefault: true });
    assert.equal(profiles.forConversation('conversation-a'), a.id);
    assert.equal(profiles.forConversation('new-conversation'), b.id);
    console.log('PASS: concurrent providers, independent homes/keys/models/efforts, exec and app-server resume, stale CLI overrides, pinned defaults and deletion guard.');
    const models = await settings.listModels(); assert.ok(Array.isArray(models));
    console.log(`PASS: bundled Codex -> local Responses server; URL, isolated API key, model, effort, streaming reply, exec/app-server start+resume, external workdir; model/list (${models.length} candidates).`);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    require('../app/main/child_process_helper').terminateManagedChildren();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'conductor-preview-api-')));
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
