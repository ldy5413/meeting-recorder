import { t } from "./i18n";
import type { Bridge, Meeting } from "../shared/types";

export interface ScreenOptions {
  sourceId: string;
  deviceId: string;
  microphone: boolean;
  system: boolean;
}

/** A single encoded stream supplies the final video and the authoritative ASR timeline. */
export class ScreenRecorder {
  streams: MediaStream[] = [];
  preview?: MediaStream;
  context?: AudioContext;
  media?: MediaRecorder;
  id: string | null = null;
  closed = false;
  stopping = false;
  paused = false;
  private pending = Promise.resolve();
  private stopPromise?: Promise<void>;
  private ended?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private seq = 0;
  private queuedBytes = 0;
  private queued = 0;
  private failureMessage = "";
  private writeFailed = false;
  private didStart = false;
  private startedAt = 0;
  private activeMs = 0;
  private lastActive = 0;
  constructor(
    private bridge: Bridge,
    private levels: (v: number[]) => void,
    private failure: (message: string) => void,
  ) {}
  get elapsedSeconds() {
    return (
      (this.activeMs +
        (this.lastActive ? performance.now() - this.lastActive : 0)) /
      1000
    );
  }
  async prepare(options: ScreenOptions) {
    try {
      await this.bridge.invoke({
        op: "screen.select",
        sourceId: options.sourceId,
        system: options.system,
      });
      if (this.closed) throw new Error(t("已取消设备检查"));
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { max: 1920 },
          height: { max: 1080 },
          frameRate: { ideal: 15, max: 15 },
        },
        audio: options.system,
      });
      this.streams.push(display);
      if (this.closed) throw new Error(t("已取消设备检查"));
      if (!display.getVideoTracks().length)
        throw new Error(t("未获得所选画面，请重新选择"));
      if (options.system && !display.getAudioTracks().length)
        throw new Error(t("未获得系统声音，请检查权限或关闭系统声音选项"));
      this.preview = new MediaStream(display.getVideoTracks());
      let mic: MediaStream | undefined;
      if (options.microphone) {
        mic = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            deviceId: options.deviceId
              ? { exact: options.deviceId }
              : undefined,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        this.streams.push(mic);
        if (this.closed) throw new Error(t("已取消设备检查"));
      }
      const tracks = [...display.getVideoTracks()];
      const audioSources = [mic, options.system ? display : undefined];
      if (audioSources.some((s) => s?.getAudioTracks().length)) {
        const context = (this.context = new AudioContext({
          sampleRate: 48000,
        }));
        const output = context.createMediaStreamDestination();
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.connect(output);
        const meters = audioSources.map((stream) => {
          if (!stream?.getAudioTracks().length) return null;
          const source = context.createMediaStreamSource(
            new MediaStream(stream.getAudioTracks()),
          );
          const analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          source.connect(limiter);
          return { analyser, buffer: new Float32Array(1024) };
        });
        this.timer = setInterval(
          () =>
            this.levels(
              meters.map((meter) => {
                if (!meter) return 0;
                meter.analyser.getFloatTimeDomainData(meter.buffer);
                return Math.min(
                  1,
                  Math.sqrt(
                    meter.buffer.reduce((n, v) => n + v * v, 0) /
                      meter.buffer.length,
                  ) * 3,
                );
              }),
            ),
          150,
        );
        await context.resume();
        tracks.push(...output.stream.getAudioTracks());
      } else this.levels([0, 0]);
      if (this.closed) throw new Error(t("已取消设备检查"));
      const mimeType = ["video/webm;codecs=vp8,opus", "video/webm"].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) throw new Error(t("此环境不支持 WebM 录制"));
      this.media = new MediaRecorder(new MediaStream(tracks), {
        mimeType,
        videoBitsPerSecond: 3_000_000,
        audioBitsPerSecond: 128_000,
      });
      this.media.ondataavailable = ({ data }) => {
        if (!data.size || !this.id || this.writeFailed || this.closed) return;
        if (data.size > 16 * 1024 * 1024) {
          this.fail(t("单次录像数据过大，已停止并保留已保存部分"), true);
          return;
        }
        const id = this.id,
          seq = this.seq++;
        this.queuedBytes += data.size;
        this.queued++;
        this.pending = this.pending
          .then(async () => {
            if (this.writeFailed) return;
            await this.bridge.invoke({
              op: "screen.chunk",
              id,
              seq,
              data: new Uint8Array(await data.arrayBuffer()),
            });
          })
          .catch((error) =>
            this.fail(t("录像保存失败：{p0}", { p0: error.message }), true),
          )
          .finally(() => {
            this.queuedBytes -= data.size;
            this.queued--;
          });
        if (this.queued > 8 || this.queuedBytes > 32 * 1024 * 1024)
          this.fail(t("磁盘写入跟不上录屏速度，已停止并保留已保存部分"));
      };
      this.media.onerror = () =>
        this.fail(t("录像编码中断，正在恢复已保存部分"));
      this.ended = new Promise((resolve) =>
        this.media!.addEventListener(
          "stop",
          () => {
            resolve();
            if (!this.stopping) this.fail(t("录制来源已结束，正在保存录像"));
          },
          { once: true },
        ),
      );
      this.streams.forEach((stream) =>
        stream.getTracks().forEach((track) => {
          track.onended = () =>
            this.fail(t("录制来源或音频设备已断开，正在保存录像"));
          track.onmute = () => {
            if (this.id && !this.stopping)
              this.failure(
                t("录制来源暂时静音或画面暂停，请检查窗口、设备与系统状态"),
              );
          };
        }),
      );
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }
  async start(id: string) {
    if (
      this.closed ||
      !this.media ||
      this.media.state !== "inactive" ||
      this.preview?.getVideoTracks()[0]?.readyState !== "live"
    )
      throw new Error(t("录制来源已结束，请重新检查设备"));
    await this.bridge.invoke({ op: "screen.start", id });
    this.id = id;
    try {
      this.media.start(1000);
      this.didStart = true;
      this.startedAt = performance.now();
      this.lastActive = this.startedAt;
    } catch (error) {
      await this.stop(true);
      throw error;
    }
  }
  async pause() {
    if (!this.media || this.stopping || this.paused) return;
    const event = new Promise<void>((resolve) =>
      this.media!.addEventListener("pause", () => resolve(), { once: true }),
    );
    this.media.pause();
    await event;
    this.activeMs += performance.now() - this.lastActive;
    this.lastActive = 0;
    this.paused = true;
  }
  async resume() {
    if (!this.media || this.stopping || !this.paused) return;
    await this.context?.resume();
    const event = new Promise<void>((resolve) =>
      this.media!.addEventListener("resume", () => resolve(), { once: true }),
    );
    this.media.resume();
    await event;
    this.lastActive = performance.now();
    this.paused = false;
  }
  private fail(message: string, discardPending = false) {
    this.writeFailed ||= discardPending;
    if (!this.failureMessage) this.failureMessage = message;
    if (!this.stopping) void this.stop(true).catch(() => {});
    this.failure(message);
  }
  stop(interrupted = false): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.stopPromise = (async () => {
      if (this.lastActive) {
        this.activeMs += performance.now() - this.lastActive;
        this.lastActive = 0;
      }
      try {
        if (this.media && this.didStart) {
          if (this.media.state !== "inactive") this.media.stop();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              this.ended,
              new Promise<void>((resolve) => {
                timer = setTimeout(() => {
                  this.failureMessage ||= t(
                    "编码器未及时结束，已恢复确认保存的部分",
                  );
                  resolve();
                }, 5000);
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
        await this.pending;
        if (this.id) {
          const meeting: Meeting = await this.bridge.invoke({
            op: "screen.stop",
            id: this.id,
            interrupted: interrupted || !!this.failureMessage,
          });
          if (meeting.capture?.status === "failed")
            throw new Error(
              meeting.capture.error || t("录像整理失败，可稍后重试恢复"),
            );
        }
      } finally {
        await this.dispose();
      }
    })();
    return this.stopPromise;
  }
  async dispose() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const stream of this.streams)
      for (const track of stream.getTracks()) {
        track.onended = null;
        track.onmute = null;
        track.stop();
      }
    this.media?.stream.getTracks().forEach((t) => t.stop());
    if (this.context && this.context.state !== "closed")
      await this.context.close();
    this.levels([0, 0]);
  }
}
