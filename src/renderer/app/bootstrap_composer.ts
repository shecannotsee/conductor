import { codexdesk } from './codexdesk.js';
import { el, localizeKnownText, t } from './state_i18n.js';
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

  bindComposerController({
    applySnapshot: deps.applySnapshot,
    renderAll,
  });
}
