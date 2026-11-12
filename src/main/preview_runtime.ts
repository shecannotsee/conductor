const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PREVIEW_NAME = 'Conductor';
const DATA_NAME = 'ConductorInstalled';
function dataDir() {
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support')
    : process.platform === 'win32' ? (process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'))
    : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  return path.join(base, DATA_NAME);
}
function codexHome(profileId = 'default') {
  if (!/^(default|[a-f0-9-]{36})$/.test(profileId)) throw new Error('Invalid profile ID');
  return profileId === 'default' ? path.join(dataDir(), 'codex') : path.join(dataDir(), 'profiles', profileId);
}
function workspaceDir() {
  const packaged = process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'app.asar'));
  const installWorkspace = path.join(packaged ? path.dirname(process.execPath) : path.resolve(__dirname, '../../..'), 'workspace');
  if (!packaged) {
    return installWorkspace;
  }
  try {
    fs.mkdirSync(installWorkspace, { recursive: true });
    fs.accessSync(installWorkspace, fs.constants.R_OK | fs.constants.W_OK);
    return installWorkspace;
  } catch {
    const fallbackBase = process.platform === 'win32'
      ? (process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'))
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library/Application Support')
        : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
    const fallback = path.join(fallbackBase, DATA_NAME, 'workspace');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}
function runtimeDir() {
  const packaged = path.join(process.resourcesPath || '', 'runtime');
  return process.resourcesPath && fs.existsSync(packaged)
    ? packaged : path.resolve(__dirname, '../../runtime');
}
function nodeBinary() { return path.join(runtimeDir(), 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node'); }
function codexVendor() {
  const target = { win32: 'pc-windows-msvc', darwin: 'apple-darwin', linux: 'unknown-linux-musl' }[process.platform];
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  return path.join(runtimeDir(), 'codex/node_modules/@openai', `codex-${process.platform}-${process.arch}`, 'vendor', `${arch}-${target}`);
}
function codexBinary() {
  const binary = path.join(codexVendor(), 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
  if (!fs.existsSync(binary)) throw new Error('内置 Codex 不完整，请修复安装或运行 npm run prepare:runtime。');
  return binary;
}
function privateEnv(source = process.env, profileId = 'default') {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^(CODEX_|OPENAI_|NPM_CONFIG_)/i.test(key) || /^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH)$/i.test(key)) delete env[key];
  }
  const inheritedPath = source.Path || source.PATH || '';
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  const vendor = codexVendor();
  env[process.platform === 'win32' ? 'Path' : 'PATH'] = [path.dirname(nodeBinary()), path.join(vendor, 'bin'), path.join(vendor, 'codex-path'), path.join(dataDir(), 'npm', 'bin'), inheritedPath].join(path.delimiter);
  env.CODEX_HOME = codexHome(profileId);
  env.CONDUCTOR_CODEX_PROFILE = profileId;
  env.NPM_CONFIG_PREFIX = path.join(dataDir(), 'npm', 'bin');
  env.NPM_CONFIG_CACHE = path.join(dataDir(), 'npm', 'cache');
  env.NPM_CONFIG_USERCONFIG = path.join(dataDir(), 'npm', 'npmrc');
  env.NPM_CONFIG_GLOBALCONFIG = path.join(dataDir(), 'npm', 'global-npmrc');
  return env;
}
module.exports = { PREVIEW_NAME, workspaceDir, dataDir, codexHome, runtimeDir, codexBinary, privateEnv, nodeBinary };
