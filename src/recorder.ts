import { t as tr } from "./i18n";
import type { Bridge } from "../shared/types";
export class Recorder {
  context!: AudioContext;
  node!: AudioWorkletNode;
  streams: MediaStream[] = [];
  pending = Promise.resolve();
  seq = 0;
  queued = 0;
  id: string | null = null;
  closed = false;
  stopping = false;
  paused = false;
  acks = new Map<string, () => void>();
  constructor(
    private bridge: Bridge,
    private levels: (v: number[]) => void,
    private failure: (message: string) => void,
  ) {}
  async prepare(deviceId: string, system: boolean) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
        video: false,
      });
      if (this.closed) {
        mic.getTracks().forEach((t) => t.stop());
        throw new Error(tr("已取消设备检查"));
      }
      this.streams.push(mic);
      if (system) {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: { width: 320, height: 240, frameRate: 1 },
        });
        if (this.closed) {
          stream.getTracks().forEach((t) => t.stop());
          throw new Error(tr("已取消设备检查"));
        }
        this.streams.push(stream);
        if (!stream.getAudioTracks().length)
          throw new Error(
            tr("未获得系统音轨，请检查系统声音权限或选择仅麦克风"),
          );
      }
      this.context = new AudioContext({ sampleRate: 48000 });
      await this.context.audioWorklet.addModule(
        new URL("./recorder-worklet.js", document.baseURI).href,
      );
      if (this.closed) throw new Error(tr("已取消设备检查"));
      this.node = new AudioWorkletNode(this.context, "meeting-capture", {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.streams.forEach((s, i) => {
        this.context
          .createMediaStreamSource(new MediaStream(s.getAudioTracks()))
          .connect(this.node, 0, i);
        s.getAudioTracks().forEach((t) => {
          t.onended = () => this.fail(tr("录音设备已断开，已保存收到的音频。"));
          t.onmute = () =>
            this.failure(tr("音轨暂时静音：请检查设备、权限或系统休眠状态。"));
        });
      });
      // The worklet outputs silence; connecting it keeps processing alive without speaker feedback.
      this.node.connect(this.context.destination);
      this.node.port.onmessage = ({ data }) => {
        if (data.ack) {
          this.acks.get(data.ack)?.();
          this.acks.delete(data.ack);
          return;
        }
        if (data.levels) {
          this.levels(data.levels);
          return;
        }
        if (!data.mic || !this.id) return;
        const id = this.id,
          seq = this.seq++;
        this.queued++;
        this.pending = this.pending
          .then(async () => {
            await this.bridge.invoke({
              op: "record.chunk",
              id,
              seq,
              mic: new Uint8Array(data.mic),
              system: new Uint8Array(data.system),
            });
          })
          .catch((e) => {
            this.fail(tr("音频保存失败：{p0}", { p0: e.message }));
          })
          .finally(() => this.queued--);
        if (this.queued > 8)
          this.fail(tr("磁盘写入跟不上录音速度，已停止并保留已落盘部分。"));
      };
      await this.context.resume();
    } catch (e) {
      await this.dispose();
      throw e;
    }
  }
  async start(id: string) {
    if (this.closed || this.stopping)
      throw new Error(tr("设备检查已结束，请重新检查"));
    await this.bridge.invoke({
      op: "record.start",
      id,
      sampleRate: this.context.sampleRate,
    });
    this.id = id;
    this.node.port.postMessage({ active: true });
  }
  async active(value: boolean) {
    const token = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.acks.delete(token);
        reject(new Error(tr("录音线程无响应，已落盘音频可在重启后恢复")));
      }, 5000);
      this.acks.set(token, () => {
        clearTimeout(timer);
        resolve();
      });
      this.node.port.postMessage({ active: value, token });
    });
  }
  async pause() {
    await this.active(false);
    await this.pending;
    this.paused = true;
  }
  async resume() {
    await this.context.resume();
    await this.active(true);
    this.paused = false;
  }
  fail(message: string) {
    if (!this.stopping) void this.stop().catch(() => this.dispose());
    this.failure(message);
  }
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    try {
      if (this.node) await this.active(false);
    } finally {
      try {
        await this.pending;
        if (this.id)
          await this.bridge.invoke({ op: "record.stop", id: this.id });
      } finally {
        await this.dispose();
      }
    }
  }
  async dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const s of this.streams)
      for (const t of s.getTracks()) {
        t.onended = null;
        t.onmute = null;
        t.stop();
      }
    this.node?.disconnect();
    if (this.context && this.context.state !== "closed")
      await this.context.close();
  }
}
