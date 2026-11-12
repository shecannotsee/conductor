const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function spawn(...args) { return require('./child_process_helper').trackChild(require('node:child_process').spawn(...args)); }
const { parse, stringify } = require('smol-toml');
const { codexHome, codexBinary, privateEnv } = require('./preview_runtime');
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
function readDocument(file, toml = false, profileId = 'default') {
  const target = path.join(codexHome(profileId), file);
  if (!fs.existsSync(target)) return {};
  try { return toml ? parse(fs.readFileSync(target, 'utf8')) : JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch { throw new Error(`${file} 格式不正确，请修复后重试。`); }
}
function readSettings(profileId = 'default') {
  const config = readDocument('config.toml', true, profileId);
  const auth = readDocument('auth.json', false, profileId);
  return {
    baseUrl: config.model_providers?.magic?.base_url || 'https://magic666.top/v1',
    model: config.model || '', effort: config.model_reasoning_effort || 'medium',
    hasApiKey: Boolean(auth.OPENAI_API_KEY), configured: Boolean(config.model && auth.OPENAI_API_KEY),
  };
}
function protectHome(profileId = 'default') {
  fs.mkdirSync(codexHome(profileId), { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const identity = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = identity.match(/S-1-5-[0-9-]+/)?.[0];
    if (!sid) throw new Error('无法确认当前 Windows 用户，未保存凭据。');
    execFileSync('icacls.exe', [codexHome(profileId), '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { stdio: 'pipe', windowsHide: true });
  }
}
function saveSettings(input, profileId = 'default') {
  const baseUrl = String(input?.baseUrl || '').trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('请输入完整的 API Base URL。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 只能包含 HTTP(S) 地址和路径。');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程 API 地址请使用 HTTPS。');
  const model = String(input?.model || '').trim();
  const effort = String(input?.effort || '');
  if (!model || model.length > 200 || /[\s\x00-\x1f]/.test(model)) throw new Error('请输入有效的模型名字（不能含空白）。');
  if (!EFFORTS.includes(effort)) throw new Error('请选择有效的推理强度。');
  const auth = readDocument('auth.json', false, profileId);
  const key = input?.clearApiKey ? '' : String(input?.apiKey || '').trim() || auth.OPENAI_API_KEY || '';
  if (key && (key.length > 8192 || /\s/.test(key))) throw new Error('API Key 不能包含空白或 Bearer 前缀。');
  const oldConfig = readDocument('config.toml', true, profileId);
  const config = { ...oldConfig, model_provider: 'magic', model, model_reasoning_effort: effort,
    cli_auth_credentials_store: 'file', model_providers: { ...oldConfig.model_providers,
      magic: { name: 'magic', base_url: baseUrl, wire_api: 'responses', requires_openai_auth: true } } };
  protectHome(profileId);
  const files = [['auth.json', JSON.stringify({ OPENAI_API_KEY: key }, null, 2) + '\n'], ['config.toml', stringify(config)]];
  const backups = files.map(([name]) => { const file = path.join(codexHome(profileId), name); return fs.existsSync(file) ? fs.readFileSync(file) : null; });
  try {
    for (const [name, text] of files) fs.writeFileSync(path.join(codexHome(profileId), name + '.tmp'), text, { mode: 0o600 });
    for (const [name] of files) fs.renameSync(path.join(codexHome(profileId), name + '.tmp'), path.join(codexHome(profileId), name));
  } catch {
    files.forEach(([name], index) => { const file = path.join(codexHome(profileId), name); if (backups[index]) fs.writeFileSync(file, backups[index]); else fs.rmSync(file, { force: true }); });
    throw new Error('保存失败，已恢复原配置。请检查文件权限和磁盘空间。');
  } finally { for (const [name] of files) fs.rmSync(path.join(codexHome(profileId), name + '.tmp'), { force: true }); }
  return readSettings(profileId);
}
// CLI overrides keep the four managed settings authoritative over project config.
function configArgs(profileId = 'default') {
  const s = readSettings(profileId);
  return ['-c', 'model_provider="magic"', ...(s.model ? ['-c', `model=${JSON.stringify(s.model)}`] : []),
    '-c', `model_reasoning_effort=${JSON.stringify(s.effort)}`, '-c', 'cli_auth_credentials_store="file"',
    '-c', `model_providers.magic.base_url=${JSON.stringify(s.baseUrl)}`,
    '-c', 'model_providers.magic.name="magic"', '-c', 'model_providers.magic.wire_api="responses"', '-c', 'model_providers.magic.requires_openai_auth=true'];
}
function listModels(profileId = 'default') {
  protectHome(profileId);
  return new Promise((resolve, reject) => {
    const child = spawn(codexBinary(), ['app-server', ...configArgs(profileId)], { env: privateEnv(process.env, profileId), cwd: codexHome(profileId), windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let buffer = ''; let finished = false; let seq = 2; const models = []; const cursors = new Set();
    const finish = (error = null, value = null) => { if (finished) return; finished = true; clearTimeout(timer); require('./child_process_helper').stopChildTree(child); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error('读取模型超时；仍可手动输入模型。')), 20000);
    const send = (method, id, params) => child.stdin.write(JSON.stringify({ method, ...(id === null ? {} : { id }), params }) + '\n');
    child.on('error', () => finish(new Error('无法启动内置 Codex。')));
    child.on('exit', () => finish(new Error('Codex 未返回模型列表。')));
    child.stdin.on('error', () => {}); child.stderr.resume();
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 4 * 1024 * 1024) return finish(new Error('模型响应过大。'));
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.error) return finish(new Error('当前 Codex / API 无法提供模型列表，请手动输入。'));
        if (msg.id === 1) { send('initialized', null, {}); send('model/list', seq, { limit: 100, includeHidden: false }); }
        else if (msg.id === seq && msg.result) {
          for (const item of msg.result.data || []) models.push({ model: item.model || item.id, name: item.displayName || item.model,
            efforts: (item.supportedReasoningEfforts || []).map(x => x.reasoningEffort).filter(x => EFFORTS.includes(x)), defaultEffort: item.defaultReasoningEffort });
          const cursor = msg.result.nextCursor;
          if (cursor && !cursors.has(cursor) && models.length < 1000) { cursors.add(cursor); seq++; send('model/list', seq, { limit: 100, cursor, includeHidden: false }); }
          else finish(null, models);
        }
      }
    });
    send('initialize', 1, { clientInfo: { name: 'conductor_preview', version: '0.2.0' } });
  });
}
function testConnection(profileId = 'default') {
  if (!readSettings(profileId).configured) throw new Error('请先保存模型和 API Key。');
  return new Promise((resolve, reject) => {
    const child = spawn(codexBinary(), ['exec', ...configArgs(profileId), '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '-c', 'features.shell_tool=false', '--json', '-'],
      { cwd: codexHome(profileId), env: privateEnv(process.env, profileId), windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let replied = false; let buffer = ''; let done = false;
    const finish = (error = null) => { if (done) return; done = true; clearTimeout(timer); require('./child_process_helper').stopChildTree(child); error ? reject(error) : resolve({ ok: true }); };
    const timer = setTimeout(() => finish(new Error('连接测试超时，请检查地址、网络和模型支持。')), 60000);
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 1024 * 1024) return finish(new Error('连接测试响应过大。'));
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0,end); buffer = buffer.slice(end+1);
        try { const event = JSON.parse(line); if (event.type === 'item.completed' && event.item?.type === 'agent_message') replied = true; } catch {} }
    });
    // Never expose raw provider error bodies, which may echo credentials.
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => finish(new Error('内置 Codex 启动失败，请检查安装。')));
    child.on('exit', code => finish(code === 0 && replied ? null : new Error('连接失败：请检查 Base URL、API Key、模型及 Responses API 支持。')));
    child.stdin.end('Reply only OK. Do not use tools or read any files.');
  });
}
module.exports = { EFFORTS, readSettings, saveSettings, configArgs, listModels, testConnection };
