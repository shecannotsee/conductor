const { StateStore } = require('../state_store');

class JsonAppStateStorage {
  [key: string]: any;

  constructor(options: any = {}) {
    this.driver = options.driver || new StateStore(options.statePath);
    this.kind = 'json';
  }

  loadState() {
    return this.driver.load();
  }

  saveState(state, options = {}) {
    const { conversationCopy } = require('../conversation_history');
    // Capture values now; serialize and fsync on the worker, never on Electron's UI thread.
    this.pending = structuredClone({ state: { ...state, conversations: state.conversations.map(conv => conversationCopy(conv, true, true)) }, options });
    this.pendingSources = state.conversations.slice();
    if (!this.worker) {
      const { Worker } = require('node:worker_threads');
      this.worker = new Worker(require('node:path').join(__dirname, 'state_writer.js'), {
        workerData: { statePath: this.driver.path, secretsPath: this.driver.secretsPath },
      });
      this.worker.unref();
      this.worker.on('message', result => {
        this.busy = false;
        this.lastError = result.error ? new Error(result.error) : null;
        if (result.error) console.error('State save failed:', result.error);
        if (!result.error && !this.pending) {
          const { attachHistory, historyLoaded } = require('../conversation_history');
          const sent = new Map(this.inflight.state.conversations.map(conv => [conv.id, conv]));
          const saved = new Map(result.histories.map(item => [item.id, item]));
          const keep = new Set([this.inflight.state.activeConversationId, ...(this.inflight.state.runningConversationIds || [])]);
          for (const conv of this.inflightSources) {
            const record: any = saved.get(conv.id);
            const captured: any = sent.get(conv.id);
            if (record && !keep.has(conv.id) && !this.isConversationBusy?.(conv.id) && historyLoaded(conv)
              && require('node:util').isDeepStrictEqual(conv.messages, captured?.messages)) {
              attachHistory(conv, this.driver.path + '.messages', record.file, record.preview);
            }
          }
        }
        this.inflight = null;
        this.inflightSources = null;
        this.pump();
      });
      this.worker.on('error', error => { this.busy = false; this.lastError = error; this.worker = null; this.finishWaiters(); });
    }
    this.pump();
  }

  pump() {
    if (this.busy) return;
    if (this.pending && this.worker) {
      const next = this.pending; this.pending = null; this.busy = true;
      this.inflight = next;
      this.inflightSources = this.pendingSources;
      this.pendingSources = null;
      this.worker.postMessage(next);
    } else this.finishWaiters();
  }

  finishWaiters() {
    for (const waiter of this.waiters || []) this.lastError ? waiter.reject(this.lastError) : waiter.resolve();
    this.waiters = [];
  }

  flush() {
    if (!this.worker && this.lastError) return Promise.reject(this.lastError);
    if (!this.busy && !this.pending) return this.lastError ? Promise.reject(this.lastError) : Promise.resolve();
    return new Promise((resolve, reject) => { (this.waiters ||= []).push({ resolve, reject }); });
  }

  unlockSecrets(password) {
    return this.driver.unlockSecrets(password);
  }

  setVaultPassword(password) {
    return this.driver.setVaultPassword(password);
  }
}

function createAppStateStorage(options: any = {}) {
  const kind = String(options.kind || 'json').trim().toLowerCase();
  if (!kind || kind === 'json') {
    return new JsonAppStateStorage(options);
  }
  throw new Error(`暂不支持的存储类型: ${kind}`);
}

module.exports = {
  JsonAppStateStorage,
  createAppStateStorage,
};
