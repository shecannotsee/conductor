const fs = require('node:fs');
const path = require('node:path');

const { app, BrowserWindow, dialog, ipcMain } = require('electron');

const { AppController } = require('./app_controller');
const { DOCS_CAPTURE_MODE } = require('./docs_capture_main');
const { resolvePackageRoot, resolveRepoRoot } = require('./project_paths');
const { registerAppIpc } = require('./ipc_registration');
const {
  applyMenuLanguage: applyMenuLanguageToApp,
  applyWindowTheme: applyThemeToWindow,
  clampZoomFactor,
  invokeUiAction: invokeWindowUiAction,
  menuText,
  normalizeLanguage,
  normalizeTheme,
  openExternalUrl,
  templateText,
} = require('./menu_window_actions');

const { PREVIEW_NAME, dataDir } = require('./preview_runtime');
app.setName(PREVIEW_NAME);
app.setPath('userData', dataDir());
app.setAppUserModelId('com.conductor.desktop');

let mainWindow = null;
let controller = null;
let menuLanguage = 'zh-CN';
let allowWindowClose = false;
let closeGuardPending = false;
function applyMenuLanguage(language) {
  menuLanguage = applyMenuLanguageToApp(language, sendMenuAction);
  return menuLanguage;
}

function applyWindowTheme(theme) {
  const normalized = normalizeTheme(theme);
  applyThemeToWindow(mainWindow, normalized);
  return normalized;
}

function invokeUiAction(rawAction) {
  return invokeWindowUiAction(rawAction, mainWindow, sendMenuAction);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunnersStop(timeoutMs = 3000, intervalMs = 120) {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    if (!controller || controller.runningConversationCount() <= 0) {
      return true;
    }
    await sleep(intervalMs);
  }
  return !controller || controller.runningConversationCount() <= 0;
}

function sendMenuAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('app:menu-action', { action: String(action || '') });
}

function sendCloseGuardPrompt(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('app:close-guard', payload || {});
}

function resolveAppIconPath() {
  const packageRoot = resolvePackageRoot(__dirname);
  const repoRoot = resolveRepoRoot(__dirname);
  const candidates = [
    path.join(packageRoot, 'build', 'icon.png'),
    path.join(repoRoot, 'resource', 'logo.png'),
    path.join(process.resourcesPath || '', 'resource', 'logo.png'),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function handleWindowCloseGuard(event) {
  if (DOCS_CAPTURE_MODE || !controller || !mainWindow || mainWindow.isDestroyed() || controller._windowSaveComplete || stateFlushedForQuit) {
    return;
  }
  const runningCount = Number(controller.runningConversationCount() || 0);
  if (runningCount <= 0 || allowWindowClose) {
    event.preventDefault();
    if (controller._windowSavePending) return;
    controller._windowSavePending = true;
    try {
      controller._persist();
      await controller.stateStorage.flush?.();
      controller._windowSaveComplete = true;
      mainWindow.close();
    } catch (error) {
      controller._windowSavePending = false;
      dialog.showErrorBox('保存失败', `窗口已保留，请重试。\n${error.message}`);
    }
    return;
  }

  event.preventDefault();
  if (closeGuardPending) {
    return;
  }
  closeGuardPending = true;

  try {
    const text = menuText(menuLanguage);
    sendCloseGuardPrompt({
      title: text.closeGuardTitle,
      message: templateText(text.closeGuardMessage, { count: runningCount }),
      detail: text.closeGuardDetail,
      cancelLabel: text.closeGuardCancel,
      stopAndCloseLabel: text.closeGuardStopAndClose,
      forceCloseLabel: text.closeGuardForceClose,
      runningCount,
    });
  } catch {
    closeGuardPending = false;
  }
}

function createWindow() {
  const icon = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    title: 'Conductor',
    width: 1460,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: false,
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  controller = new AppController(mainWindow);
  allowWindowClose = false;
  closeGuardPending = false;
  applyMenuLanguage(menuLanguage);
  mainWindow.setAutoHideMenuBar(false);
  mainWindow.setMenuBarVisibility(false);
  applyWindowTheme('light');
  const wc = mainWindow.webContents;
  wc.session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    return contents === mainWindow?.webContents && permission === 'media' && details.mediaType === 'audio';
  });
  wc.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === mainWindow?.webContents && permission === 'media'
      && details.mediaTypes?.length > 0 && details.mediaTypes.every(type => type === 'audio'));
  });


  wc.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (!openExternalUrl(url)) {
      return;
    }
    event.preventDefault();
  });
  wc.on('before-input-event', (event, input) => {
    if (
      input
      && input.type === 'keyDown'
      && input.key === 'Alt'
      && !input.control
      && !input.shift
      && !input.meta
    ) {
      event.preventDefault();
      mainWindow.setMenuBarVisibility(false);
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('page-title-updated', (event) => { event.preventDefault(); mainWindow.setTitle(PREVIEW_NAME); });
  mainWindow.setTitle(PREVIEW_NAME);

  mainWindow.on('close', (event) => {
    handleWindowCloseGuard(event).catch(() => {});
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc() {
  registerAppIpc({
    app,
    dialog,
    ipcMain,
    getMainWindow: () => mainWindow,
    getController: () => controller,
    getMenuLanguage: () => menuLanguage,
    applyMenuLanguage,
    applyWindowTheme,
    clampZoomFactor,
    invokeUiAction,
    getCloseGuardPending: () => closeGuardPending,
    setCloseGuardPending: (value) => {
      closeGuardPending = Boolean(value);
    },
    setAllowWindowClose: (value) => {
      allowWindowClose = Boolean(value);
    },
    waitForRunnersStop,
  });
}

if (!app.requestSingleInstanceLock()) { app.quit(); }
else app.whenReady().then(() => {
  menuLanguage = normalizeLanguage(app.getLocale());
  registerIpc();
  createWindow();

  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

let stateFlushedForQuit = false;
app.on('before-quit', (event) => {
  if (!stateFlushedForQuit && controller?.stateStorage?.flush) {
    event.preventDefault();
    if (controller._quitFlushPending) return;
    controller._quitFlushPending = true;
    controller._persist();
    controller.stateStorage.flush().then(() => {
      stateFlushedForQuit = true;
      app.quit();
    }).catch(error => {
      controller._quitFlushPending = false;
      dialog.showErrorBox('保存失败', `未退出程序，请重试以保存会话。\n${error.message}`);
    });
    return;
  }
  controller?.shutdownServices?.();
  require('./child_process_helper').terminateManagedChildren();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
