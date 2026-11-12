// Assemble only inside this checkout. Never install globally or update PATH.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'runtime');
const downloads = path.join(root, '.runtime-downloads');
const version = '24.14.0';
async function download(url, target) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
}
async function main() {
  if (!['win32', 'darwin', 'linux'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('Unsupported runtime platform');
  const windows = process.platform === 'win32';
  const platform = windows ? 'win' : process.platform;
  const stem = `node-v${version}-${platform}-${process.arch}`;
  fs.mkdirSync(downloads, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  const filename = `${stem}.${windows ? "zip" : "tar.gz"}`;
  const zip = path.join(downloads, filename);
  const sums = path.join(downloads, 'SHASUMS256.txt');
  await download(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`, sums);
  if (!fs.existsSync(zip)) await download(`https://nodejs.org/dist/v${version}/${filename}`, zip);
  const line = fs.readFileSync(sums, 'utf8').split('\n').find(x => x.trim().endsWith(` ${filename}`));
  const digest = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  if (!line || digest !== line.split(/\s+/)[0]) throw new Error('Node archive SHA256 mismatch; remove cached archive and retry');
  const nodeRoot = path.join(runtime, 'node');
  const node = path.join(nodeRoot, windows ? 'node.exe' : 'bin/node');
  if (!fs.existsSync(node)) {
    const quote = s => "'" + s.replace(/'/g, "''") + "'";
    if (windows) execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(downloads)} -Force`], { stdio: 'inherit', windowsHide: true });
    else execFileSync('tar', ['-xzf', zip, '-C', downloads], { stdio: 'inherit' });
    fs.cpSync(path.join(downloads, stem), nodeRoot, { recursive: true });
  }
  const codexRoot = path.join(runtime, 'codex');
  fs.mkdirSync(codexRoot, { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, 'runtime-package', file), path.join(codexRoot, file));
  const env = { ...process.env, NPM_CONFIG_CACHE: path.join(downloads, 'npm-cache'), NPM_CONFIG_USERCONFIG: path.join(downloads, 'npmrc') };
  execFileSync(node, [path.join(nodeRoot, windows ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js'),
    'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: codexRoot, env, stdio: 'inherit', windowsHide: true });
  const triple = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-${{ win32: 'pc-windows-msvc', darwin: 'apple-darwin', linux: 'unknown-linux-musl' }[process.platform]}`;
  const codex = path.join(codexRoot, `node_modules/@openai/codex-${process.platform}-${process.arch}/vendor`, triple, 'bin', windows ? 'codex.exe' : 'codex');
  execFileSync(codex, ['--version'], { stdio: 'inherit', windowsHide: true });
  fs.writeFileSync(path.join(runtime, 'manifest.json'), JSON.stringify({ node: version, codex: '0.154.0', nodeSha256: digest }, null, 2));
  console.log(`Private ${process.platform}/${process.arch} runtime ready.`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
