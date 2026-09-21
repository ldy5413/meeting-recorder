class MeetingCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.mic = new Int16Array(sampleRate);
    this.system = new Int16Array(sampleRate);
    this.offset = 0;
    this.meterFrames = 0;
    this.peak = [0, 0];
    this.port.onmessage = ({ data }) => {
      if (data.active === false) this.flush();
      this.active = data.active;
      if (data.token) this.port.postMessage({ ack: data.token });
    };
  }
  flush() {
    if (!this.offset) return;
    const mic = this.mic.slice(0, this.offset),
      system = this.system.slice(0, this.offset);
    this.port.postMessage({ mic: mic.buffer, system: system.buffer }, [
      mic.buffer,
      system.buffer,
    ]);
    this.offset = 0;
  }
  process(inputs, outputs) {
    const length = outputs[0]?.[0]?.length ?? 128;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < 2; channel++) {
        const input = inputs[channel] ?? [];
        let value = 0;
        for (const samples of input) value += samples[i] ?? 0;
        value /= Math.max(1, input.length);
        this.peak[channel] = Math.max(this.peak[channel], Math.abs(value));
        if (this.active)
          (channel === 0 ? this.mic : this.system)[this.offset] = Math.round(
            Math.max(-1, Math.min(1, value)) * 32767,
          );
      }
      if (this.active && ++this.offset === this.mic.length) this.flush();
    }
    this.meterFrames += length;
    if (this.meterFrames > sampleRate / 10) {
      this.port.postMessage({ levels: this.peak });
      this.peak = [0, 0];
      this.meterFrames = 0;
    }
    return true;
  }
}
registerProcessor("meeting-capture", MeetingCapture);
