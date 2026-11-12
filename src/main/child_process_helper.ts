const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function getPathValue(env) {
  const source = env || process.env;
  return String(source.PATH || source.Path || source.path || '');
}

function getPathExts(env) {
  const source = env || process.env;
  const value = String(source.PATHEXT || source.PathExt || '.COM;.EXE;.BAT;.CMD');
  return value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasPathSeparator(command) {
  return /[\\/]/.test(String(command || ''));
}

function candidateNames(command, env) {
  const raw = String(command || '').trim();
  if (!raw || process.platform !== 'win32' || path.extname(raw)) {
    return [raw];
  }
  return [...getPathExts(env).map((ext) => `${raw}${ext}`), raw];
}

function resolveCommand(command, env) {
  const raw = String(command || '').trim();
  if (!raw) {
    return raw;
  }

  const names = candidateNames(raw, env);
  if (hasPathSeparator(raw)) {
    const baseDir = path.dirname(raw);
    for (const name of names) {
      const candidate = path.isAbsolute(name) ? name : path.join(baseDir, path.basename(name));
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return raw;
  }

  const pathDirs = getPathValue(env)
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return raw;
}

function requiresWindowsShell(command) {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(String(command || ''));
}

function quoteCmdArg(value) {
  const raw = String(value ?? '');
  if (!raw) {
    return '""';
  }
  const escaped = raw
    .replace(/"/g, '\\"')
    .replace(/([&|<>()^%])/g, '^$1');
  return `"${escaped}"`;
}

function normalizeSpawnOptions(command, args: any[] = [], options: any = {}) {
  const isCodex = /^codex(?:\.exe|\.cmd|\.ps1)?$/i.test(path.basename(String(command)));
  if (isCodex && ['exec', 'app-server'].includes(args[0])) {
    const settings = require('./codex_settings');
    const profileId = options.env?.CONDUCTOR_CODEX_PROFILE || 'default';
    if (!settings.readSettings(profileId).configured) throw new Error('请先在 API 设置中保存模型和 API Key。');
    // Profile settings take precedence over old per-conversation CLI options.
    const cleaned = [];
    const managed = /^(model|model_provider|model_reasoning_effort|cli_auth_credentials_store|model_providers(?:\.|\s*=))/;
    for (let index = 0; index < args.length; index++) {
      const token = String(args[index]);
      if (token === '--') { cleaned.push(...args.slice(index)); break; }
      if (['--model', '-m', '--profile', '-p'].includes(token)) { index++; continue; }
      if (/^--(?:model|profile)=/.test(token)) continue;
      if (['-c', '--config'].includes(token) && managed.test(String(args[index + 1] || ''))) { index++; continue; }
      if (token.startsWith('--config=') && managed.test(token.slice(9))) continue;
      cleaned.push(args[index]);
    }
    args = [...settings.configArgs(profileId), ...cleaned];
  }
  const resolved = isCodex ? require('./preview_runtime').codexBinary() : resolveCommand(command, options.env);
  if (requiresWindowsShell(resolved)) {
    const commandLine = `"${[resolved, ...args].map(quoteCmdArg).join(' ')}"`;
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine],
      options: {
        ...options,
        shell: false,
        windowsVerbatimArguments: true,
      },
    };
  }
  return {
    command: resolved,
    args,
    options: {
      ...options,
    },
  };
}

function spawnCommand(command, args = [], options: any = {}) {
  const normalized = normalizeSpawnOptions(command, args, { windowsHide: true, ...options });
  return trackChild(spawn(normalized.command, normalized.args, normalized.options));
}

function spawnSyncCommand(command, args = [], options: any = {}) {
  const normalized = normalizeSpawnOptions(command, args, { windowsHide: true, ...options });
  return spawnSync(normalized.command, normalized.args, normalized.options);
}

const managedChildren = new Set<any>();
function trackChild(child) {
  managedChildren.add(child);
  child.once('exit', () => managedChildren.delete(child));
  child.once('error', () => managedChildren.delete(child));
  return child;
}
function stopChildTree(child) {
  if (!child) return;
  if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') {
      try { require('node:child_process').execFileSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }); } catch { child.kill('SIGTERM'); }
    } else child.kill('SIGTERM');
  }
  child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
}
function terminateManagedChildren() {
  for (const child of managedChildren) stopChildTree(child);
}
module.exports = {
  trackChild, stopChildTree, terminateManagedChildren,
  resolveCommand,
  spawnCommand,
  spawnSyncCommand,
};
