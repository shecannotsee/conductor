// Use an isolated copy of the pinned NSIS templates, preserving builder's
// normal two-stage installer/uninstaller generation and signing pipeline.
const templates = require('./prepare-installer');
require('app-builder-lib/out/targets/nsis/nsisUtil').nsisTemplatesDir = templates;
const { build, Platform, Arch } = require('electron-builder');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  await build({ targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config: 'electron-builder.windows.yml' });
  const packageRoot = path.resolve(__dirname, '..');
  const outputDir = path.resolve(packageRoot, '..', 'dist', 'windows');
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const installerName = `Conductor-${packageJson.version}-win-x64-Setup.exe`;
  const installerPath = path.join(outputDir, installerName);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex');
  fs.writeFileSync(path.join(outputDir, `SHA256SUMS-${packageJson.version}.txt`), `${hash}  ${installerName}\n`, 'utf8');
  console.log(`SHA256 ${hash}  ${installerName}`);
})().catch(error => { console.error(error); process.exit(1); });
