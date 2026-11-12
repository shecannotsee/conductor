const { parentPort, workerData } = require('node:worker_threads');
const { StateStore } = require('../state_store');
const store = new StateStore(workerData.statePath, workerData.secretsPath);
parentPort.on('message', ({ state, options }) => {
  try {
    if (options.vaultKey) options.vaultKey = Buffer.from(options.vaultKey);
    const histories = store.save(state, options);
    parentPort.postMessage({ ok: true, histories });
  } catch (error) { parentPort.postMessage({ error: error.message }); }
});
