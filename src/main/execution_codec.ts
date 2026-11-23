function normalizeExecution(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return undefined;
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .filter(item => item && typeof item.text === 'string' && item.text.trim())
    .map(item => ({ id: String(item.id || ''), text: item.text, ...(Number.isFinite(Number(item.createdAt)) && Number(item.createdAt) > 0 ? { createdAt: Number(item.createdAt) } : {}) }));
  const status = ['running', 'completed', 'failed', 'interrupted'].includes(raw.status) ? raw.status : 'interrupted';
  return { id: String(raw.id), status, steps, hasFinal: Boolean(raw.hasFinal), startedAt: Number(raw.startedAt) || 0, completedAt: Number(raw.completedAt) || 0 };
}
module.exports = { normalizeExecution };
