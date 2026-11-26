import { codexdesk } from './codexdesk.js';
import { el, localizeKnownText, state, t } from './state_i18n.js';
import { showAppNotice } from './app_notice.js';
import { bindComposerController } from './composer_controller.js';
import { renderAll } from './renderers.js';

export function bindComposerInit(deps: { applySnapshot: (snapshot: any) => void }) {
  if (el.composerWorkdirValue) {
    el.composerWorkdirValue.addEventListener('contextmenu', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const workdir = String(el.composerWorkdirValue?.getAttribute('data-copy-text') || '').trim();
      if (!workdir) return;
      try {
        await codexdesk.copyText(workdir);
        showAppNotice(t('copySuccess'), 'success');
      } catch {
        showAppNotice(localizeKnownText('复制失败'), 'error');
      }
    });
  }

  el.btnChangeConversationWorkdir?.addEventListener('click', async () => {
    const conversationId = state.activeConversationId;
    const conversation = state.conversations.find(item => item.id === conversationId);
    if (!conversationId || !conversation) return;
    const picked = await codexdesk.pickWorkdir({ defaultPath: conversation.workdir });
    if (picked?.canceled) return;
    if (picked?.error || !picked?.directoryPath) {
      showAppNotice(localizeKnownText(picked?.error || '未选择工作目录。'), 'error');
      return;
    }
    const result = await codexdesk.setConversationWorkdir(conversationId, picked.directoryPath);
    if (result?.error) {
      showAppNotice(localizeKnownText(result.error), 'error');
      if (result.snapshot) deps.applySnapshot(result.snapshot);
      renderAll();
      return;
    }
    deps.applySnapshot(result);
    renderAll();
    showAppNotice(t(result.workdirUnchanged ? 'conversationWorkdirUnchanged' : 'conversationWorkdirChanged'), 'success');
  });

  bindComposerController({
    applySnapshot: deps.applySnapshot,
    renderAll,
  });
}
