const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-uninstall-test-'));
try {
  const root = path.join(temp, 'ConductorInstalled');
  const other = path.join(temp, 'Conductor');
  fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'original.txt'), 'untouched');
  const profile = '00000000-0000-0000-0000-000000000001';
  for (const home of [path.join(root, 'codex'), path.join(root, 'profiles', profile)]) {
    fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(home, 'auth.json'), '{"OPENAI_API_KEY":"fake-retained"}');
    fs.writeFileSync(path.join(home, 'config.toml'), 'model="test"');
    fs.writeFileSync(path.join(home, 'sessions', 'private.jsonl'), 'history');
  }
  fs.writeFileSync(path.join(root, 'profiles.json'), JSON.stringify({ defaultId: profile, profiles: [{ id: profile, name: '中文服务商 B' }], conversations: { old: profile } }));
  fs.writeFileSync(path.join(root, 'state.electron.json'), 'history');
  const script = process.argv[2] || path.resolve(__dirname, '../scripts/windows/uninstall-data.ps1');
  const run = mode => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode], { env: { ...process.env, APPDATA: temp }, windowsHide: true });
  run('KeepConfig');
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'profiles.json'), 'utf8'));
  assert.equal(saved.profiles[0].name, '中文服务商 B'); assert.deepEqual(saved.conversations, {});
  for (const home of [path.join(root, 'codex'), path.join(root, 'profiles', profile)]) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'))).OPENAI_API_KEY, 'fake-retained');
    assert.ok(fs.existsSync(path.join(home, 'config.toml')));
    assert.equal(fs.existsSync(path.join(home, 'sessions')), false);
  }
  assert.equal(fs.existsSync(path.join(root, 'state.electron.json')), false);
  run('Full'); assert.equal(fs.existsSync(root), false);
  assert.equal(fs.readFileSync(path.join(other, 'original.txt'), 'utf8'), 'untouched');
  console.log('PASS: keep all provider credentials and Chinese names, remove history/bindings, full cleanup, preserve source app data.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
