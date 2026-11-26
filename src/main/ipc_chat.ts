import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  parseCancelQueuedMessagePayload,
  parseChatInsertPayload,
  parseChatSendPayload,
  parseConversationIdPayload,
} from './ipc_contracts';

interface ChatController {
  sendMessage(payload: ReturnType<typeof parseChatSendPayload>): unknown;
  insertMessage(payload: ReturnType<typeof parseChatInsertPayload>): unknown;
  retryLastMessage(conversationId: string): unknown;
  cancelQueuedMessage(conversationId: string, messageId: string, index: number): unknown;
  cancelAllQueuedMessages(conversationId: string): unknown;
}

interface ChatIpcOptions {
  ipcMain: IpcMain;
  getMainWindow: () => BrowserWindow | null;
  getController: () => ChatController;
}

function assertMainFrame(event: IpcMainInvokeEvent, getMainWindow: ChatIpcOptions['getMainWindow']): void {
  const window = getMainWindow();
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('无效的请求来源。');
  }
}

export function registerChatIpc({ ipcMain, getMainWindow, getController }: ChatIpcOptions): void {
  ipcMain.handle('chat:send', (event, payload: unknown) => {
    assertMainFrame(event, getMainWindow);
    return getController().sendMessage(parseChatSendPayload(payload));
  });

  ipcMain.handle('chat:insert', (event, payload: unknown) => {
    assertMainFrame(event, getMainWindow);
    return getController().insertMessage(parseChatInsertPayload(payload));
  });

  ipcMain.handle('chat:retry-last', (event, payload: unknown) => {
    assertMainFrame(event, getMainWindow);
    return getController().retryLastMessage(parseConversationIdPayload(payload).conversationId);
  });

  ipcMain.handle('chat:cancel-queued-message', (event, payload: unknown) => {
    assertMainFrame(event, getMainWindow);
    const request = parseCancelQueuedMessagePayload(payload);
    return getController().cancelQueuedMessage(request.conversationId, request.queuedMessageId, request.queuedIndex);
  });

  ipcMain.handle('chat:cancel-all-queued-messages', (event, payload: unknown) => {
    assertMainFrame(event, getMainWindow);
    return getController().cancelAllQueuedMessages(parseConversationIdPayload(payload).conversationId);
  });
}
