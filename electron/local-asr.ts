import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { SegmentSchema, type Segment } from "../shared/types";
import { mediaCommand } from "./video";
import { AsrModels } from "./asr-models";

export interface LocalAsrRequest {
  audio: string;
  language: "zh" | "en";
  task: "transcribe" | "speakers";
  keywords: string[];
  segments: Segment[];
  speakers: Record<string, string>;
  expectedSpeakers?: number;
  signal: AbortSignal;
  progress: (step: string) => void;
}
export interface LocalAsrRunner {
  run(
    request: LocalAsrRequest,
  ): Promise<{ segments: Segment[]; [key: string]: unknown }>;
}

/** One inference process at a time. Cancellation never releases a running slot early. */
export class LocalAsr implements LocalAsrRunner {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private resources: string,
    private scratch: string,
    private models?: AsrModels,
  ) {}

  run(request: LocalAsrRequest) {
    request.signal.throwIfAborted();
    request.progress("等待本机转写队列");
    let started = false;
    const result = this.tail
      .catch(() => {})
      .then(() => {
        started = true;
        return this.execute(request);
      });
    this.tail = result.catch(() => {});
    return new Promise<Awaited<typeof result>>((resolve, reject) => {
      const abort = () => {
        if (!started) reject(new Error("任务已取消"));
      };
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
      void result
        .then(resolve, reject)
        .finally(() => request.signal.removeEventListener("abort", abort));
    });
  }

  private async execute(request: LocalAsrRequest) {
    const { signal, progress } = request;
    signal.throwIfAborted();
    const executable = join(
      this.resources,
      "worker",
      process.platform === "win32" ? "meeting-asr.exe" : "meeting-asr",
    );
    if (!existsSync(executable))
      throw new Error("本地转写组件不完整，请重新安装应用");
    if (!this.models) throw new Error("本地模型目录未配置");
    const models = await this.models.ensure(
      request.language,
      request.task === "speakers",
      signal,
      progress,
    );
    await mkdir(this.scratch, { recursive: true });
    const work = await mkdtemp(join(this.scratch, "asr-"));
    try {
      progress("在本机准备音频");
      const probe = JSON.parse(
        (
          await mediaCommand(
            "ffprobe",
            [
              "-v",
              "error",
              "-show_entries",
              "format=duration",
              "-of",
              "json",
              request.audio,
            ],
            signal,
          )
        ).toString(),
      );
      const duration = Number(probe.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0)
        throw new Error("音频时长无效");
      const wav = join(work, "audio.wav");
      await mediaCommand(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          "-i",
          request.audio,
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-af",
          "aresample=16000:async=1:first_pts=0",
          "-c:a",
          "pcm_s16le",
          "-t",
          String(duration),
          wav,
        ],
        signal,
      );
      signal.throwIfAborted();
      const input = join(work, "request.json"),
        output = join(work, "result.json");
      await writeFile(
        input,
        JSON.stringify({
          audio: wav,
          output,
          models,
          language: request.language,
          task: request.task,
          keywords: request.keywords,
          segments: request.segments,
          speakers: request.speakers,
          expected_speakers: request.expectedSpeakers,
          threads: 4,
        }),
        "utf8",
      );
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, ["--request", input], {
          windowsHide: true,
          cwd: dirname(executable),
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PYTHONUTF8: "1", CUDA_VISIBLE_DEVICES: "-1" },
        });
        let buffer = "",
          stderr = "",
          failure: Error | undefined;
        const abort = () => {
          failure = new Error("任务已取消");
          child.kill();
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (text: string) => {
          buffer += text;
          if (buffer.length > 64 * 1024) {
            failure = new Error("本地转写进度输出异常");
            child.kill();
            return;
          }
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            let event: { type?: string; step?: unknown };
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            try {
              if (
                event.type === "progress" &&
                typeof event.step === "string" &&
                !signal.aborted
              )
                progress(event.step.slice(0, 200));
            } catch (error) {
              failure = error as Error;
              child.kill();
            }
          }
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (text: string) => {
          stderr = (stderr + text).slice(-4000);
        });
        child.on("error", (error) => {
          failure = error;
        });
        child.on("close", (code) => {
          signal.removeEventListener("abort", abort);
          if (failure) reject(failure);
          else if (code !== 0)
            reject(new Error(`本地转写失败 (${code})：${stderr.slice(-1500)}`));
          else resolve();
        });
      });
      signal.throwIfAborted();
      return z
        .object({ segments: z.array(SegmentSchema) })
        .passthrough()
        .parse(JSON.parse(await readFile(output, "utf8")));
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}
