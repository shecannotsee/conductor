import type { ConversationMessage, ConversationSummary } from './types.js';
import { currentLang, escapeHtml, t } from './state_i18n.js';
import { messagePreview, isConversationRunning } from './conversation_runtime.js';
import { renderMarkdownLike } from './markdown_renderer.js';

const stageOptions = new Map<string, { collapsed: boolean; markdown: boolean }>();
function toggleExecutionMessage(key: string, action: string) {
  const options = stageOptions.get(key) || { collapsed: false, markdown: true };
  if (action === 'collapse') options.collapsed = !options.collapsed;
  else options.markdown = !options.markdown;
  stageOptions.set(key, options);
}
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
    const key = `${conversation.id}:${execution.id}:${step.id}`;
    const options = stageOptions.get(key) || { collapsed: false, markdown: true };
    const content = options.markdown ? renderMarkdownLike(step.text) : `<div class="msg-plain-text">${escapeHtml(step.text)}</div>`;
    const last = index === visibleSteps.length - 1;
    const time = formatTime(step.createdAt || execution.startedAt || item.createdAt);
    const timeTitle = step.createdAt ? '' : label('旧消息未记录阶段时间，显示任务开始时间', 'Stage time unavailable; showing task start time');
    return `<div class="execution-message${running && last ? ' is-running' : ''}">
      <div class="msg-head"><div class="msg-role">${escapeHtml(role)}</div>${last && status ? `<span class="execution-status">${status}</span>` : ''}<div class="msg-actions">
        <button type="button" class="msg-toggle-render" data-execution-key="${escapeHtml(key)}" data-execution-action="render" aria-pressed="${options.markdown}" ${options.collapsed ? 'disabled' : ''}>${escapeHtml(t(options.markdown ? 'renderMarkdown' : 'renderRaw'))}</button>
        <button type="button" class="msg-toggle-collapse" data-execution-key="${escapeHtml(key)}" data-execution-action="collapse" aria-expanded="${!options.collapsed}">${escapeHtml(t(options.collapsed ? 'expandMessage' : 'collapseMessage'))}</button>
      </div></div>
      <div class="msg-bubble msg-assistant execution-step${options.collapsed ? ' collapsed' : ''}"><div class="msg-expanded">${content}</div><div class="msg-collapsed-line">${escapeHtml(messagePreview(step.text))}</div><div class="msg-footer"><span></span><div class="msg-time" title="${escapeHtml(timeTitle)}">${escapeHtml(time)}</div></div></div>
    </div>`;
  }).join('');
}
export { renderExecution, toggleExecutionMessage };
