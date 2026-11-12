class ConductorPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 10); this.pending = new Float32Array(this.size); this.offset = 0;
    this.port.onmessage = event => {
      if (event.data === 'flush') { this.flush(); this.port.postMessage({ type: 'flushed' }); }
    };
  }
  flush() {
    if (!this.offset) return;
    const samples = this.pending.slice(0, this.offset);
    this.port.postMessage({ type: 'audio', samples }, [samples.buffer]); this.offset = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) for (const sample of channel) { this.pending[this.offset++] = sample; if (this.offset === this.size) this.flush(); }
    return true;
  }
}
registerProcessor('conductor-pcm', ConductorPcm);
