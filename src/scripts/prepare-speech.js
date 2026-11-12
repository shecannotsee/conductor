const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'runtime/speech');
const manifest = require('../speech-package/models.json');
async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function main() {
  if (!['win32', 'darwin', 'linux'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('Unsupported speech platform');
  const node = path.join(root, 'runtime/node', process.platform === 'win32' ? 'node.exe' : 'bin/node');
  const npm = path.join(root, 'runtime/node', process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js');
  if (!fs.existsSync(node)) throw new Error('Run npm run prepare:runtime first, on the target platform');
  fs.mkdirSync(path.join(target, 'models'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, 'speech-package', file), path.join(target, file));
  execFileSync(node, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: target, windowsHide: true, stdio: 'inherit',
    env: { ...process.env, NPM_CONFIG_CACHE: path.join(root, '.runtime-downloads/npm-cache') },
  });
  // Node reads proxy environment variables; on Windows also honor the user's system proxy for build downloads.
  if (process.platform === 'win32' && !process.env.HTTPS_PROXY && !process.env.https_proxy) {
    try {
      const proxy = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$p = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; @{enabled=$p.ProxyEnable;server=$p.ProxyServer} | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true }));
      if (proxy.enabled && proxy.server && !/[=@]/.test(proxy.server)) {
        process.env.HTTPS_PROXY = /^https?:/.test(proxy.server) ? proxy.server : `http://${proxy.server}`;
        require('node:http').setGlobalProxyFromEnv();
      }
    } catch {}
  }
  for (const entry of manifest.files) {
    const file = path.join(target, 'models', entry.file);
    if (fs.existsSync(file) && fs.statSync(file).size === entry.size && await digest(file) === entry.sha256) { console.log(`Verified ${entry.file}`); continue; }
    console.log(`Downloading ${entry.file} (${Math.round(entry.size / 1048576)} MiB)`);
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(entry.url, { signal: AbortSignal.timeout(600000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file + '.part'));
        if (fs.statSync(file + '.part').size !== entry.size || await digest(file + '.part') !== entry.sha256) throw new Error('Model checksum mismatch');
        fs.renameSync(file + '.part', file); failure = null; break;
      } catch (error) { failure = error; console.error(`Attempt ${attempt + 1}: ${error.message}`); }
    }
    if (failure) throw failure;
  }
  fs.copyFileSync(path.join(root, 'speech-package/models.json'), path.join(target, 'models/manifest.json'));
  fs.copyFileSync(path.join(root, 'speech-package/worker.cjs'), path.join(target, 'worker.cjs'));
  fs.cpSync(path.join(root, 'speech-package/licenses'), path.join(target, 'licenses'), { recursive: true });
  execFileSync(node, ['-e', "require('sherpa-onnx-node'); console.log('Native speech runtime ready: ' + process.platform + '/' + process.arch)"], { cwd: target, windowsHide: true, stdio: 'inherit', env: { ...process.env, LD_LIBRARY_PATH: path.join(target, 'node_modules', `sherpa-onnx-${process.platform}-${process.arch}`), DYLD_LIBRARY_PATH: path.join(target, 'node_modules', `sherpa-onnx-${process.platform}-${process.arch}`) } });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
