import type { ConversationMessage, ConversationSummary } from './types.js';
import { currentLang, el, escapeHtml, state } from './state_i18n.js';
import { isConversationRunning } from './conversation_runtime.js';
import { renderMarkdownLike } from './markdown_renderer.js';
import { codexdesk } from './codexdesk.js';
import { showAppNotice } from './app_notice.js';

const expanded = new Map<string, boolean>();
let bound = false;
const label = (zh: string, en: string) => currentLang() === 'en-US' ? en : zh;
function bindExecutionActions() {
  if (bound) return;
  bound = true;
  el.chatView.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target : null;
    const summary = target?.closest('summary[data-execution-key]');
    if (summary) {
      expanded.set(summary.getAttribute('data-execution-key'), !(summary.parentElement as HTMLDetailsElement).open);
    }
    const copy = target?.closest<HTMLElement>('[data-reply-copy]');
    if (!copy) return;
    const conv = state.conversations.find(item => item.id === state.activeConversationId);
    const message = conv?.messages[Number(copy.dataset.msgIndex)];
    if (!message) return;
    const text = copy.dataset.replyCopy === 'all'
      ? [...(message.execution?.steps || []).map(item => item.text), message.text].filter(Boolean).join('\n\n')
      : message.text;
    try { await codexdesk.copyText(text); showAppNotice(label('已复制', 'Copied'), 'success'); }
    catch { showAppNotice(label('复制失败，请重试', 'Copy failed. Please retry.'), 'error'); }
  });
}

function renderExecution(item: ConversationMessage, conversation: ConversationSummary, index: number): string {
  if (!item.execution) return '';
  bindExecutionActions();
  const execution = item.execution;
  const running = execution.status === 'running' && isConversationRunning(conversation.id)
    && conversation.messages[conversation.messages.length - 1] === item;
  const status = running ? label('进行中', 'In progress')
    : execution.status === 'failed' ? label('失败', 'Failed')
      : execution.status === 'interrupted' || execution.status === 'running' ? label('已中断', 'Interrupted')
        : item.text.trim() ? label('已完成', 'Completed') : label('未收到最终答复', 'No final response');
  const key = `${conversation.id}:${execution.id}`;
  // Keep explicit expansion choices across stream updates and completion.
  const open = expanded.get(key) ?? (!running && (!item.text.trim() || ['failed', 'interrupted'].includes(execution.status)));
  const steps = execution.steps || [];
  const seconds = Math.max(0, Math.round((execution.completedAt || Date.now() / 1000) - execution.startedAt));
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  const count = `${steps.length} ${label('段进展', 'updates')}`;
  const preview = running && steps.length ? steps.slice(-1).map(step => `<div class="execution-preview-text">${escapeHtml(step.text)}</div>`).join('') : '';
  return `<section class="execution-panel${running ? ' is-running' : ''}" aria-label="${label('执行过程', 'Execution progress')}">
    <details class="execution-details" ${open ? 'open' : ''}>
      <summary data-execution-key="${escapeHtml(key)}"><span class="execution-chevron" aria-hidden="true">›</span><strong>${label('执行过程', 'Execution progress')}</strong><span class="execution-status">${status}</span><span class="execution-count">${count} · ${duration}</span></summary>
      <div class="execution-steps">${steps.map((step, i) => `<div class="execution-step"><span class="execution-number">${i + 1}</span><div>${renderMarkdownLike(step.text)}</div></div>`).join('') || `<p>${label('暂无阶段说明，详细操作见运行面板。', 'No progress notes. See the runtime panel for operations.')}</p>`}</div>
      <button type="button" class="execution-copy" data-reply-copy="all" data-msg-index="${index}">${label('复制完整回复', 'Copy full reply')}</button>
    </details>
    ${preview ? `<div class="execution-preview">${preview}</div>` : ''}
  </section>`;
}

function renderReplyCopy(item: ConversationMessage, index: number): string {
  if (item.role !== 'assistant' || !item.text.trim()) return '';
  bindExecutionActions();
  return `<button type="button" data-reply-copy="result" data-msg-index="${index}">${label('复制答复', 'Copy reply')}</button>`;
}
export { renderExecution, renderReplyCopy };
