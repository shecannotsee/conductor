const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { openLocalPath } = require('./local_path_opener');
const { registerDocsCaptureIpc } = require('./docs_capture_main');
const { resolveRepoRoot } = require('./project_paths');
const {
  TELEGRAM_LOG_PATH,
  formatTelegramLogs,
  listTelegramLogs,
} = require('./telegram');

function resourceDirCandidates(preferPackagedResourceDir = false) {
  const repoResourceDir = path.join(resolveRepoRoot(__dirname), 'resource');
  const packagedResourceDir = path.join(process.resourcesPath || '', 'resource');
  return preferPackagedResourceDir
    ? [packagedResourceDir, repoResourceDir]
    : [repoResourceDir, packagedResourceDir];
}

function resolveResourceBaseUrl(preferPackagedResourceDir = false) {
  const candidates = resourceDirCandidates(preferPackagedResourceDir);
  const resourceDir = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  return resourceDir ? pathToFileURL(`${resourceDir}${path.sep}`).toString() : '';
}

function registerAppIpc({
  app,
  dialog,
  ipcMain,
  getMainWindow,
  getController,
  getMenuLanguage,
  applyMenuLanguage,
  applyWindowTheme,
  clampZoomFactor,
  invokeUiAction,
  getCloseGuardPending,
  setCloseGuardPending,
  setAllowWindowClose,
  waitForRunnersStop,
}) {
  const { SpeechService } = require('./speech_service');
  const speech = new SpeechService(payload => {
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.webContents.send('speech:event', payload);
  });
  app.on('before-quit', () => speech.dispose());
  for (const [channel, operation] of [
    ['speech:status', () => speech.status()],
    ['speech:start', payload => speech.start(payload?.sampleRate)],
    ['speech:audio', payload => speech.audio(payload?.sessionId, payload?.samples)],
    ['speech:stop', payload => speech.finish(payload?.sessionId)],
    ['speech:cancel', () => speech.dispose()],
  ] as any[]) {
    ipcMain.handle(channel, async (event, payload) => {
      if (event.sender !== getMainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) return { ok: false, error: '无效的录音请求来源。' };
      try { return { ok: true, value: await operation(payload) }; }
      catch (error) { return { ok: false, error: error.message || '语音识别失败。' }; }
    });
  }
  app.on('web-contents-created', (_, contents) => {
    contents.on('render-process-gone', () => speech.dispose());
    contents.on('destroyed', () => { if (!getMainWindow() || getMainWindow().isDestroyed()) speech.dispose(); });
    contents.on('did-start-navigation', (_, url, _inPlace, isMainFrame) => { if (isMainFrame) speech.dispose(); });
  });

  ipcMain.handle('ui:set-menu-language', async (_, payload) => {
    const language = applyMenuLanguage(payload?.language);
    return { ok: true, language };
  });

  ipcMain.handle('ui:set-window-theme', async (_, payload) => {
    const theme = applyWindowTheme(payload?.theme);
    return { ok: true, theme };
  });

  ipcMain.handle('ui:get-zoom-factor', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: '窗口不可用' };
    }
    return { ok: true, zoomFactor: clampZoomFactor(mainWindow.webContents.getZoomFactor()) };
  });

  ipcMain.handle('ui:set-zoom-factor', async (_, payload) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: '窗口不可用' };
    }
    const zoomFactor = clampZoomFactor(payload?.zoomFactor);
    mainWindow.webContents.setZoomFactor(zoomFactor);
    return { ok: true, zoomFactor };
  });

  ipcMain.handle('ui:invoke-action', async (_, payload) => {
    return invokeUiAction(payload?.action);
  });

  const codexSettings = require('./codex_settings');
  const profiles = require('./codex_profiles');
  let codexSettingsBusy = false;
  for (const [channel, operation] of [
    ['codex-settings:read', () => codexSettings.readSettings()],
    ['codex-settings:save', payload => codexSettings.saveSettings(payload)],
    ['codex-settings:models', payload => codexSettings.listModels(profiles.requireProfile(payload?.id || 'default'))],
    ['codex-settings:test', payload => codexSettings.testConnection(profiles.requireProfile(payload?.id || 'default'))],
    ['codex-profiles:list', payload => profiles.list(payload?.conversationId)],
    ['codex-profiles:save', payload => {
      const controller = getController();
      if (payload?.id && Array.from(controller.runners.keys()).some(id => profiles.forConversation(id) === payload.id)) throw new Error('此配置正在执行任务，请结束后再修改。');
      profiles.pinExisting(controller.conversations);
      return profiles.save(payload);
    }],
    ['codex-profiles:delete', payload => { profiles.pinExisting(getController().conversations); return profiles.remove(payload?.id); }],
    ['codex-profiles:bind', payload => {
      const controller = getController();
      const conv = controller.conversations.find(item => item.id === payload?.conversationId);
      if (!conv) throw new Error('请选择对话。');
      if (controller.runners.has(conv.id) || controller._pendingQueueSize(conv.id)) throw new Error('请等待此对话的任务和队列结束后再切换配置。');
      const previous = profiles.forConversation(conv.id);
      profiles.bind(conv.id, payload.id);
      if (previous !== payload.id) {
        conv.sessionId = ''; conv.sessionContinuationMode = '';
        controller._ensureMeta(conv.id)['会话ID'] = '-';
        controller._emit({ type: 'meta-updated', conversationId: conv.id, key: '会话ID', value: '-' });
        controller.refreshModelInfo(conv.id);
        controller._syncConversationUpdated(conv);
        controller._persist();
        controller._appendStructuredEvent(conv.id, 'hint', '已切换 API 配置，下次使用新的原生会话；本地聊天记录保留。');
      }
      return profiles.list(conv.id);
    }],
  ] as any[]) {
    ipcMain.handle(channel, async (event, payload) => {
      if (event.sender !== getMainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) return { ok: false, error: '无效的请求来源。' };
      if (codexSettingsBusy) return { ok: false, error: '请等待当前配置操作完成。' };
      if (channel === 'codex-settings:save' && getController().runningConversationCount() > 0) return { ok: false, error: '请等待运行中的任务结束后修改配置。' };
      codexSettingsBusy = true;
      try { return { ok: true, value: await operation(payload) }; }
      catch (error) { return { ok: false, error: error.message || '配置操作失败。' }; }
      finally { codexSettingsBusy = false; }
    });
  }

  ipcMain.handle('app:get-snapshot', async () => getController().snapshot());
  ipcMain.handle('conversation:read', async (event, payload) => {
    if (event.sender !== getMainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('无效的请求来源。');
    const conv = getController().conversations.find(item => item.id === payload?.conversationId);
    if (!conv) return null;
    const history = require('./conversation_history');
    await history.loadHistory(conv);
    return history.conversationCopy(conv, true);
  });
  ipcMain.handle('conversation:reveal-file', async (event, payload) => {
    if (event.sender !== getMainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) return { error: '无效的请求来源。' };
    try {
      const conv = getController().conversations.find(item => item.id === payload?.conversationId);
      if (!conv) throw new Error('会话不存在。');
      if (conv.provider === 'claude') throw new Error('此会话暂不支持定位会话文件。');
      const home = require('./preview_runtime').codexHome(profiles.forConversation(conv.id));
      const roots = [path.join(home, 'sessions'), path.join(home, 'archived_sessions')];
      // Imported conversations may still live in the user's external Codex home.
      roots.push(path.join(os.homedir(), '.codex', 'sessions'), path.join(os.homedir(), '.codex', 'archived_sessions'));
      const file = await require('./session_file_locator').findSessionFile(conv.sessionId, roots, conv.sessionFileId === conv.sessionId ? conv.sessionFile : '');
      require('electron').shell.showItemInFolder(file);
      return { ok: true };
    } catch (error) { return { error: error.message || '无法定位会话文件。' }; }
  });

  ipcMain.handle('app:get-info', async () => ({
    ok: true,
    name: app.getName(),
    version: app.getVersion(),
    resourceBaseUrl: resolveResourceBaseUrl(Boolean(app?.isPackaged)),
  }));
  ipcMain.handle('app:get-telegram-logs', async () => {
    const entries = listTelegramLogs(200);
    return {
      ok: true,
      logCount: entries.length,
      logPath: TELEGRAM_LOG_PATH,
      logsText: formatTelegramLogs(entries),
    };
  });

  ipcMain.handle('app:update-settings', async (_, payload) => getController().updateSettings(payload || {}));
  ipcMain.handle('app:set-master-password', async (_, payload) => getController().setMasterPassword(payload?.password));
  ipcMain.handle('app:unlock-master-password', async (_, payload) => {
    await getController().stateStorage.flush?.();
    return getController().unlockMasterPassword(payload?.password);
  });
  ipcMain.handle('app:lock-master-password', async () => getController().lockMasterPassword());
  ipcMain.handle('app:test-notification-provider', async () => getController().testNotificationProvider());
  ipcMain.handle('app:test-remote-control-provider', async () => getController().testRemoteControlProvider());
  ipcMain.handle('app:pick-workdir', async (_, payload) => {
    const mainWindow = getMainWindow();
    const controller = getController();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: '窗口不可用' };
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: getMenuLanguage() === 'en-US' ? 'Choose Working Directory' : '选择工作目录',
      defaultPath: String(payload?.defaultPath || controller?._defaultWorkdir?.() || '').trim() || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
      return { canceled: true, snapshot: controller.snapshot() };
    }

    return {
      ok: true,
      snapshot: controller.snapshot(),
      directoryPath: result.filePaths[0],
    };
  });

  let conversationSwitchSeq = 0;
  ipcMain.handle('conversation:switch', async (_, payload) => {
    const seq = ++conversationSwitchSeq;
    const id = String(payload?.conversationId || '');
    const conv = getController().conversations.find(item => item.id === id);
    if (conv) await require('./conversation_history').loadHistory(conv);
    if (seq !== conversationSwitchSeq) return getController()._conversationSwitchPayload();
    return getController().switchConversation(id);
  });

  ipcMain.handle('conversation:create', async (_, payload) => getController().createConversation(payload || {}));

  ipcMain.handle('conversation:pick-import-session', async () => {
    const mainWindow = getMainWindow();
    const controller = getController();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: '窗口不可用' };
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入 CLI 会话',
      defaultPath: path.join(require('./preview_runtime').codexHome(profiles.forConversation(controller.activeConversationId)), 'sessions'),
      properties: ['openFile'],
      filters: [
        { name: 'Conductor Session', extensions: ['jsonl'] },
        { name: 'JSON', extensions: ['json', 'jsonl'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
      return { canceled: true, snapshot: controller.snapshot() };
    }

    try {
      return {
        snapshot: controller.snapshot(),
        preview: controller.previewConversationImportFromSessionFile(result.filePaths[0]),
      };
    } catch (error) {
      return {
        error: `导入会话失败: ${error?.message || String(error)}`,
        snapshot: controller.snapshot(),
      };
    }
  });

  ipcMain.handle('conversation:import-session-file', async (_, payload) => {
    const controller = getController();
    const filePath = String(payload?.filePath || '');
    const continuationMode = String(payload?.continuationMode || 'resume');
    const workdirChoice = {
      mode: String(payload?.workdirChoice?.mode || 'default'),
      workdir: String(payload?.workdirChoice?.workdir || ''),
    };
    try {
      return controller.importConversationFromSessionFile(filePath, { continuationMode, workdirMode: workdirChoice.mode, workdir: workdirChoice.workdir });
    } catch (error) {
      return {
        error: `导入会话失败: ${error?.message || String(error)}`,
        snapshot: controller.snapshot(),
      };
    }
  });

  ipcMain.handle('conversation:export-session', async (_, payload) => {
    const mainWindow = getMainWindow();
    const controller = getController();
    const conversationId = String(payload?.conversationId || '');
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: '窗口不可用' };
    }

    try {
      const preview = controller.previewConversationExport(conversationId);
      const defaultDir = path.join(os.homedir(), 'Downloads');
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出当前会话',
        defaultPath: path.join(defaultDir, preview.suggestedFileName),
        filters: [
          { name: 'Conductor Session', extensions: ['jsonl'] },
          { name: 'JSON', extensions: ['json', 'jsonl'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true, snapshot: controller.snapshot() };
      }

      return controller.exportConversationToSessionFile(preview.conversationId, result.filePath);
    } catch (error) {
      return {
        error: `导出会话失败: ${error?.message || String(error)}`,
        snapshot: controller.snapshot(),
      };
    }
  });

  ipcMain.handle('conversation:rename', async (_, payload) => {
    const title = String(payload?.title || '');
    const conversationId = String(payload?.conversationId || '');
    return getController().renameConversation(conversationId, title);
  });

  ipcMain.handle('conversation:toggle-pin', async (_, payload) => {
    const conversationId = String(payload?.conversationId || '');
    return getController().toggleConversationPin(conversationId);
  });

  ipcMain.handle('conversation:close-current', async () => getController().closeCurrentConversation());

  ipcMain.handle('meta:refresh-codex-version', async (_, payload) => {
    const conversationId = String(payload?.conversationId || '');
    return getController().refreshCodexVersion(conversationId);
  });

  ipcMain.handle('meta:refresh-model', async (_, payload) => {
    const conversationId = String(payload?.conversationId || '');
    return getController().refreshModelInfo(conversationId);
  });

  ipcMain.handle('conversation:clear-chat', async (_, payload) => {
    return getController().clearChat(String(payload?.conversationId || ''));
  });

  ipcMain.handle('conversation:clear-runtime', async (_, payload) => {
    return getController().clearRuntime(String(payload?.conversationId || ''), {
      silent: Boolean(payload?.silent),
    });
  });

  ipcMain.handle('conversation:stop', async (_, payload) => {
    return getController().stopConversation(String(payload?.conversationId || ''));
  });

  ipcMain.handle('chat:send', async (_, payload) => {
    const options = payload?.options && typeof payload.options === 'object' ? payload.options : {};
    return getController().sendMessage({
      conversationId: String(payload?.conversationId || ''),
      text: String(payload?.text || ''),
      attachments: Array.isArray(payload?.attachments) ? payload.attachments : [],
      appendUserMessage: options.appendUserMessage !== false,
      forceFreshSession: Boolean(options.forceFreshSession),
      fromRetry: Boolean(options.fromRetry),
      goalMode: Boolean(options.goalMode),
    });
  });

  ipcMain.handle('chat:insert', async (_, payload) => {
    return getController().insertMessage({
      conversationId: String(payload?.conversationId || ''),
      text: String(payload?.text || ''),
    });
  });

  ipcMain.handle('chat:retry-last', async (_, payload) => {
    return getController().retryLastMessage(String(payload?.conversationId || ''));
  });

  ipcMain.handle('chat:cancel-queued-message', async (_, payload) => {
    return getController().cancelQueuedMessage(
      String(payload?.conversationId || ''),
      String(payload?.queuedMessageId || ''),
      Number(payload?.queuedIndex || 0),
    );
  });

  ipcMain.handle('chat:cancel-all-queued-messages', async (_, payload) => {
    return getController().cancelAllQueuedMessages(String(payload?.conversationId || ''));
  });

  ipcMain.handle('shell:open-path', async (_, payload) => {
    return openLocalPath(payload?.path);
  });

  ipcMain.handle('app:resolve-close-guard', async (_, payload) => {
    const action = String(payload?.action || '').trim();
    const controller = getController();
    if (!getCloseGuardPending()) {
      return { ok: false, ignored: true };
    }
    try {
      if (action === 'cancel') {
        return { ok: true, canceled: true };
      }
      if (action === 'stop-and-close') {
        controller?.stopAllRunningConversations();
        await waitForRunnersStop(3000);
      } else if (action === 'force-close') {
        controller?.stopAllRunningConversations();
      } else {
        return { ok: false, error: '无效动作' };
      }

      setAllowWindowClose(true);
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
      return { ok: true };
    } finally {
      setCloseGuardPending(false);
    }
  });

  registerDocsCaptureIpc({
    app,
    ipcMain,
    getMainWindow,
    setAllowWindowClose,
  });
}

module.exports = {
  registerAppIpc,
};
