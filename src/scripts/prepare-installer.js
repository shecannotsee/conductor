// Constrain cleanup to this distribution: the source app owns APPDATA/Conductor.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const templates = path.join(root, 'node_modules/app-builder-lib/templates/nsis');
const output = path.join(root, 'build/nsis');
fs.mkdirSync(output, { recursive: true });
fs.cpSync(templates, output, { recursive: true });
// common.nsh is included after customHeader and otherwise hides both detail panes.
const commonPath = path.join(output, 'common.nsh');
const common = fs.readFileSync(commonPath, 'utf8');
if (!common.includes('ShowInstDetails nevershow') || !common.includes('ShowUninstDetails nevershow')) {
  throw new Error('NSIS detail settings changed; review installer template.');
}
fs.writeFileSync(commonPath, common.replace('ShowInstDetails nevershow', 'ShowInstDetails show').replace('ShowUninstDetails nevershow', 'ShowUninstDetails show'));
const assistedPath = path.join(output, 'assistedInstaller.nsh');
let assisted = fs.readFileSync(assistedPath, 'utf8');
for (const [page, prefix] of [['MUI_PAGE_INSTFILES', ''], ['MUI_UNPAGE_INSTFILES', 'un.']]) {
  const marker = `!insertmacro ${page}`;
  if (!assisted.includes(marker)) throw new Error('NSIS progress page changed.');
  assisted = assisted.replace(marker, `!define MUI_PAGE_CUSTOMFUNCTION_SHOW ${prefix}ConductorProgressShow\n  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE ${prefix}ConductorProgressLeave\n  ${marker}`);
}
fs.writeFileSync(assistedPath, assisted);
const extractPath = path.join(output, 'include/extractAppPackage.nsh');
let extract = fs.readFileSync(extractPath, 'utf8');
if (!extract.includes('  Nsis7z::Extract "${FILE}"') || !extract.includes('    CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR')) {
  throw new Error('NSIS extraction steps changed; review installer details.');
}
extract = extract
  .replace('  Nsis7z::Extract "${FILE}"', '  DetailPrint "正在解压 Conductor 应用和随附运行环境"\n  Nsis7z::Extract "${FILE}"')
  .replace('    CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR', '    DetailPrint "正在将应用文件写入：$OUTDIR"\n    CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR');
fs.writeFileSync(extractPath, extract);
let uninstall = fs.readFileSync(path.join(templates, 'uninstaller.nsh'), 'utf8');
const start = uninstall.indexOf('  ${if} $isDeleteAppData == "1"');
const end = uninstall.indexOf('  DeleteRegKey SHELL_CONTEXT', start);
if (start < 0 || end < 0) throw new Error('NSIS template changed; review cleanup before building.');
uninstall = uninstall.slice(0, start) + '  ; Data cleanup is handled by customUnInstall.\n\n' + uninstall.slice(end);
fs.writeFileSync(path.join(output, 'uninstaller.nsh'), uninstall);
module.exports = output;
