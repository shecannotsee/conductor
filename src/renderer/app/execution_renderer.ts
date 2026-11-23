import type { ConversationMessage, ConversationSummary } from './types.js';
import { currentLang, escapeHtml } from './state_i18n.js';
import { isConversationRunning } from './conversation_runtime.js';
import { renderMarkdownLike } from './markdown_renderer.js';

const label = (zh: string, en: string) => currentLang() === 'en-US' ? en : zh;
function renderExecution(item: ConversationMessage, conversation: ConversationSummary, role: string): string {
  const execution = item.execution;
  if (!execution?.steps?.length) return '';
  const running = execution.status === 'running' && isConversationRunning(conversation.id)
    && conversation.messages[conversation.messages.length - 1] === item;
  const interrupted = execution.status === 'interrupted' || (execution.status === 'running' && !running);
  const status = running ? label('正在执行中', 'In progress')
    : execution.status === 'failed' ? label('失败', 'Failed')
      : interrupted ? label('已中断', 'Interrupted')
        : !item.text.trim() ? label('未收到答复', 'No response') : '';
  return execution.steps.map((step, index) => {
    const last = index === execution.steps.length - 1;
    return `<div class="execution-message${running && last ? ' is-running' : ''}">
      <div class="msg-head"><div class="msg-role">${escapeHtml(role)}<span class="execution-phase-label">${label('过程', 'Progress')}</span></div>${last && status ? `<span class="execution-status">${status}</span>` : ''}</div>
      <div class="msg-bubble msg-assistant execution-step">${renderMarkdownLike(step.text)}</div>
    </div>`;
  }).join('');
}
export { renderExecution };
