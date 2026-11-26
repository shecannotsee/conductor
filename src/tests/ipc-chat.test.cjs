const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseChatSendPayload,
  parseChatInsertPayload,
  parseCancelQueuedMessagePayload,
} = require('../app/main/ipc_contracts');
const { registerChatIpc } = require('../app/main/ipc_chat');

test('chat IPC contracts normalize optional fields and reject malformed values', () => {
  assert.deepEqual(parseChatSendPayload({ conversationId: 'conv-1', text: 'hello' }), {
    conversationId: 'conv-1',
    text: 'hello',
    attachments: [],
    options: {
      appendUserMessage: true,
      forceFreshSession: false,
      fromRetry: false,
      goalMode: false,
    },
  });
  assert.deepEqual(parseChatInsertPayload({ conversationId: 'conv-1', text: 'follow up' }), {
    conversationId: 'conv-1', text: 'follow up',
  });
  assert.deepEqual(parseCancelQueuedMessagePayload({
    conversationId: 'conv-1', queuedMessageId: 'queue-1',
  }), {
    conversationId: 'conv-1', queuedMessageId: 'queue-1', queuedIndex: 0,
  });

  assert.throws(() => parseChatSendPayload({ conversationId: 'conv-1', text: { value: 'not text' } }), /消息内容/);
  assert.throws(() => parseChatSendPayload({ conversationId: 'conv-1', text: 'hello', options: { goalMode: 'yes' } }), /goalMode/);
  assert.throws(() => parseChatSendPayload({ conversationId: 'conv-1', text: 'hello', attachments: [{}] }), /附件路径/);
  assert.throws(() => parseCancelQueuedMessagePayload({
    conversationId: 'conv-1', queuedMessageId: 'queue-1', queuedIndex: -1,
  }), /非负整数/);
});

test('chat IPC handlers accept only the main window main frame', async () => {
  const handlers = new Map();
  const calls = [];
  const webContents = { mainFrame: {} };
  const window = { webContents, isDestroyed: () => false };
  const controller = {
    sendMessage: payload => { calls.push(['send', payload]); return 'sent'; },
    insertMessage: payload => { calls.push(['insert', payload]); return 'inserted'; },
    retryLastMessage: id => { calls.push(['retry', id]); return 'retried'; },
    cancelQueuedMessage: (...args) => { calls.push(['cancel', ...args]); return 'canceled'; },
    cancelAllQueuedMessages: id => { calls.push(['cancel-all', id]); return 'canceled-all'; },
  };
  registerChatIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getMainWindow: () => window,
    getController: () => controller,
  });
  const event = { sender: webContents, senderFrame: webContents.mainFrame };

  assert.equal(await handlers.get('chat:send')(event, { conversationId: 'conv-1', text: 'hello' }), 'sent');
  assert.deepEqual(calls[0][1].options, {
    appendUserMessage: true, forceFreshSession: false, fromRetry: false, goalMode: false,
  });
  assert.throws(() => handlers.get('chat:send')({ ...event, senderFrame: {} }, {
    conversationId: 'conv-1', text: 'hello',
  }), /请求来源/);
  assert.throws(() => handlers.get('chat:send')(event, { conversationId: 'conv-1', text: 12 }), /消息内容/);
  assert.equal(calls.length, 1);
});
