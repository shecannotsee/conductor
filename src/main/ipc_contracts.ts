export interface ChatSendOptions {
  appendUserMessage: boolean;
  forceFreshSession: boolean;
  fromRetry: boolean;
  goalMode: boolean;
}

export interface ChatAttachmentPayload {
  path: string;
  name?: string;
  mimeType?: string;
  size?: number;
  kind?: string;
}

export interface ChatSendPayload {
  conversationId: string;
  text: string;
  attachments: ChatAttachmentPayload[];
  options: ChatSendOptions;
}

export interface ChatInsertPayload {
  conversationId: string;
  text: string;
}

export interface ConversationIdPayload {
  conversationId: string;
}

export interface CancelQueuedMessagePayload extends ConversationIdPayload {
  queuedMessageId: string;
  queuedIndex: number;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}格式无效。`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}必须是非空文本。`);
  }
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值。`);
  return value;
}

function parseConversationId(value: unknown): ConversationIdPayload {
  const payload = requireRecord(value, '会话请求');
  return { conversationId: requireString(payload.conversationId, '会话 ID') };
}

export function parseChatSendPayload(value: unknown): ChatSendPayload {
  const payload = requireRecord(value, '发送消息请求');
  const rawOptions = payload.options === undefined ? {} : requireRecord(payload.options, '发送选项');
  const rawAttachments = payload.attachments === undefined ? [] : payload.attachments;
  if (!Array.isArray(rawAttachments)) throw new Error('附件必须是数组。');

  const attachments = rawAttachments.map((item, index): ChatAttachmentPayload => {
    const attachment = requireRecord(item, `第 ${index + 1} 个附件`);
    const parsed: ChatAttachmentPayload = { path: requireString(attachment.path, '附件路径') };
    for (const key of ['name', 'mimeType', 'kind'] as const) {
      const field = attachment[key];
      if (field !== undefined) {
        if (typeof field !== 'string') throw new Error(`附件 ${key} 必须是文本。`);
        parsed[key] = field;
      }
    }
    if (attachment.size !== undefined) {
      if (typeof attachment.size !== 'number' || !Number.isFinite(attachment.size) || attachment.size < 0) {
        throw new Error('附件大小必须是非负数。');
      }
      parsed.size = attachment.size;
    }
    return parsed;
  });

  return {
    conversationId: requireString(payload.conversationId, '会话 ID'),
    text: requireString(payload.text, '消息内容'),
    attachments,
    options: {
      appendUserMessage: optionalBoolean(rawOptions.appendUserMessage, true, 'appendUserMessage'),
      forceFreshSession: optionalBoolean(rawOptions.forceFreshSession, false, 'forceFreshSession'),
      fromRetry: optionalBoolean(rawOptions.fromRetry, false, 'fromRetry'),
      goalMode: optionalBoolean(rawOptions.goalMode, false, 'goalMode'),
    },
  };
}

export function parseChatInsertPayload(value: unknown): ChatInsertPayload {
  const payload = requireRecord(value, '插入消息请求');
  return {
    conversationId: requireString(payload.conversationId, '会话 ID'),
    text: requireString(payload.text, '消息内容'),
  };
}

export function parseConversationIdPayload(value: unknown): ConversationIdPayload {
  return parseConversationId(value);
}

export function parseCancelQueuedMessagePayload(value: unknown): CancelQueuedMessagePayload {
  const payload = requireRecord(value, '撤销排队请求');
  const queuedIndex = payload.queuedIndex === undefined ? 0 : payload.queuedIndex;
  if (typeof queuedIndex !== 'number' || !Number.isInteger(queuedIndex) || queuedIndex < 0) {
    throw new Error('排队序号必须是非负整数。');
  }
  return {
    ...parseConversationId(payload),
    queuedMessageId: requireString(payload.queuedMessageId, '排队消息 ID'),
    queuedIndex,
  };
}
