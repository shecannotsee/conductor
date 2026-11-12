// Constrain cleanup to this distribution: the source app owns APPDATA/Conductor.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const templates = path.join(root, 'node_modules/app-builder-lib/templates/nsis');
const output = path.join(root, 'build/nsis');
fs.mkdirSync(output, { recursive: true });
fs.cpSync(templates, output, { recursive: true });
let uninstall = fs.readFileSync(path.join(templates, 'uninstaller.nsh'), 'utf8');
const start = uninstall.indexOf('  ${if} $isDeleteAppData == "1"');
const end = uninstall.indexOf('  DeleteRegKey SHELL_CONTEXT', start);
if (start < 0 || end < 0) throw new Error('NSIS template changed; review cleanup before building.');
uninstall = uninstall.slice(0, start) + '  ; Data cleanup is handled by customUnInstall.\n\n' + uninstall.slice(end);
fs.writeFileSync(path.join(output, 'uninstaller.nsh'), uninstall);
module.exports = output;
