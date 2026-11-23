import type { ConversationMessage, ConversationSummary } from './types.js';
import { currentLang, escapeHtml } from './state_i18n.js';
import { isConversationRunning } from './conversation_runtime.js';
import { renderMarkdownLike } from './markdown_renderer.js';

const label = (zh: string, en: string) => currentLang() === 'en-US' ? en : zh;
function renderExecution(item: ConversationMessage, conversation: ConversationSummary, role: string, formatTime: (input: unknown) => string): string {
  const execution = item.execution;
  if (!execution) return '';
  const running = execution.status === 'running' && isConversationRunning(conversation.id)
    && conversation.messages[conversation.messages.length - 1] === item;
  const interrupted = execution.status === 'interrupted' || (execution.status === 'running' && !running);
  const status = running ? ''
    : execution.status === 'failed' ? label('失败', 'Failed')
      : interrupted ? label('已中断', 'Interrupted')
        : !item.text.trim() && conversation.messages[conversation.messages.length - 1] === item ? label('未收到答复', 'No response') : '';
  const visibleSteps = execution.steps.filter(step => step.completed !== false || !running);
  if (!running && execution.activeText && !visibleSteps.some(step => step.text === execution.activeText)) {
    visibleSteps.push({ id: 'interrupted-output', text: execution.activeText });
  }
  return visibleSteps.map((step, index) => {
    const last = index === visibleSteps.length - 1;
    const time = formatTime(step.createdAt || execution.startedAt || item.createdAt);
    const timeTitle = step.createdAt ? '' : label('旧消息未记录阶段时间，显示任务开始时间', 'Stage time unavailable; showing task start time');
    return `<div class="execution-message${running && last ? ' is-running' : ''}">
      <div class="msg-head"><div class="msg-role">${escapeHtml(role)}</div>${last && status ? `<span class="execution-status">${status}</span>` : ''}</div>
      <div class="msg-bubble msg-assistant execution-step">${renderMarkdownLike(step.text)}<div class="msg-footer"><span></span><div class="msg-time" title="${escapeHtml(timeTitle)}">${escapeHtml(time)}</div></div></div>
    </div>`;
  }).join('');
}
export { renderExecution };
