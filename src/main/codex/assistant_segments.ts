// Only explicit protocol phases classify progress; never infer it from wording.
class AssistantSegments {
  items = new Map();
  update(id, input = {}) {
    const value: any = input;
    const key = String(id || 'unidentified');
    const previous = this.items.get(key) || { id: key, text: '', phase: '' };
    const rawPhase = String(value.phase || value.channel || previous.phase || '');
    const phase = rawPhase === 'commentary' ? 'commentary'
      : ['final', 'final_answer'].includes(rawPhase) ? 'final' : rawPhase;
    const text = typeof value.text === 'string' ? value.text : previous.text + String(value.delta || '');
    this.items.set(key, { id: key, text, phase });
    return Array.from(this.items.values()).map(item => ({ ...item }));
  }
}
module.exports = { AssistantSegments };
