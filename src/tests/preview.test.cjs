const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-preview-test-'));
process.env.APPDATA = temp;
const runtime = require('../app/main/preview_runtime');
const settings = require('../app/main/codex_settings');
const { spawnSyncCommand } = require('../app/main/child_process_helper');
after(() => { assert.ok(temp.startsWith(path.join(os.tmpdir(), 'conductor-preview-test-'))); fs.rmSync(temp, { recursive: true, force: true }); });
test('private environment excludes host credentials and preserves external tools', () => {
  const source = { ...process.env, Path: 'C:\\ExternalTools', CODEX_HOME: 'C:\\HostCodex', OPENAI_API_KEY: 'host-secret', npm_config_prefix: 'C:\\HostNpm', NODE_OPTIONS: '--bad-option' };
  const env = runtime.privateEnv(source);
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.npm_config_prefix, undefined); assert.equal(env.CODEX_HOME, runtime.codexHome());
  assert.ok(env.Path.endsWith('C:\\ExternalTools')); assert.ok(env.NPM_CONFIG_PREFIX.startsWith(temp));
  assert.equal(source.CODEX_HOME, 'C:\\HostCodex');
});
test('four settings round-trip, preserve unrelated TOML and never expose the key', () => {
  const original = settings.readSettings(); assert.equal(original.configured, false);
  const saved = settings.saveSettings({ baseUrl: 'https://example.com/v1/', model: 'custom-model', effort: 'high', apiKey: 'fake-test-secret' });
  assert.equal(saved.baseUrl, 'https://example.com/v1'); assert.equal(saved.hasApiKey, true);
  assert.ok(!JSON.stringify(saved).includes('fake-test-secret'));
  const configPath = path.join(runtime.codexHome(), 'config.toml');
  fs.appendFileSync(configPath, '\n[features]\nexample = true\n');
  settings.saveSettings({ baseUrl: saved.baseUrl, model: 'custom-model-2', effort: 'medium', apiKey: '' });
  assert.match(fs.readFileSync(configPath, 'utf8'), /example = true/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime.codexHome(), 'auth.json'))).OPENAI_API_KEY, 'fake-test-secret');
  assert.throws(() => settings.saveSettings({ baseUrl: 'https://example.com/?key=secret', model: 'a', effort: 'high' }));
  assert.equal(settings.readSettings().model, 'custom-model-2');
});
test('bundled Node, npm and Codex run without system Node/Codex PATH', () => {
  const env = runtime.privateEnv({ ...process.env, Path: process.env.SystemRoot + '\\System32', PATH: '' });
  const node = path.join(runtime.runtimeDir(), 'node/node.exe');
  assert.match(execFileSync(node, ['--version'], { env, encoding: 'utf8' }), /^v24\.14\.0/);
  const npm = path.join(runtime.runtimeDir(), 'node/node_modules/npm/bin/npm-cli.js');
  const prefix = execFileSync(node, [npm, 'config', 'get', 'prefix'], { env, encoding: 'utf8', cwd: temp }).trim();
  assert.equal(prefix, env.NPM_CONFIG_PREFIX);
  const result = spawnSyncCommand('codex', ['--version'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0); assert.match(result.stdout, /0\.154\.0/);
  const help = spawnSyncCommand('codex', ['exec', '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
});
test('clear key removes authentication and prevents new runs', () => {
  settings.saveSettings({ ...settings.readSettings(), clearApiKey: true });
  assert.equal(settings.readSettings().configured, false);
  assert.throws(() => spawnSyncCommand('codex', ['exec', '--help'], { env: runtime.privateEnv() }), /API Key/);
});
test('deleted conversations release their profile bindings', () => {
  const profiles = require('../app/main/codex_profiles');
  const value = profiles.save({ name: 'Temporary provider', baseUrl: 'https://example.com/v1', model: 'test', effort: 'medium', apiKey: 'fake-unused' });
  profiles.bind('deleted-conversation', value.id);
  assert.throws(() => profiles.remove(value.id), /对话/);
  profiles.pinExisting([]);
  profiles.remove(value.id);
  assert.equal(fs.existsSync(runtime.codexHome(value.id)), false);
});
