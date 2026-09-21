import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  VideoSchema,
  type Meeting,
  type Video,
  type VisualFrame,
} from "../shared/types";
import type { Store } from "./store";

export const frameDirectory = (audioDir: string) =>
  join(dirname(audioDir), "frames");

/** Argument arrays, hidden child processes and bounded output; never invoke a shell. */
export async function mediaCommand(
  tool: "ffmpeg" | "ffprobe",
  args: string[],
  signal?: AbortSignal,
  consume?: (chunk: Buffer) => void,
) {
  signal?.throwIfAborted();
  const executable = process.env[tool.toUpperCase()] || tool;
  return new Promise<Buffer>((resolveResult, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "",
      bytes = 0,
      failure: Error | undefined;
    const chunks: Buffer[] = [];
    child.stderr.on("data", (b) => {
      stderr = (stderr + b.toString()).slice(-4000);
    });
    child.stdout.on("data", (b: Buffer) => {
      try {
        if (consume) consume(b);
        else {
          bytes += b.length;
          if (bytes > 8 * 1024 * 1024) throw new Error("媒体工具输出过大");
          chunks.push(b);
        }
      } catch (e) {
        failure = e as Error;
        child.kill();
      }
    });
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        e.code === "ENOENT"
          ? new Error(
              `未找到 ${tool}。录像导入与画面提取需要本机 FFmpeg，请安装并加入 PATH，或设置 ${tool.toUpperCase()} 可执行文件路径。`,
            )
          : e,
      ),
    );
    child.on("close", (code) => {
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new Error(`${tool} 处理失败 (${code})：${stderr.slice(-1500)}`));
      else resolveResult(Buffer.concat(chunks));
    });
  });
}

export async function probeVideo(
  file: string,
  signal?: AbortSignal,
): Promise<Video | undefined> {
  const raw = await mediaCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,width,height:stream_disposition=attached_pic",
      "-of",
      "json",
      resolve(file),
    ],
    signal,
  );
  const probe = JSON.parse(raw.toString());
  const video = probe.streams?.find(
    (s: any) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  if (!video) return undefined;
  return VideoSchema.parse({
    duration: Number(probe.format.duration),
    width: video.width,
    height: video.height,
    hasAudio: probe.streams.some((s: any) => s.codec_type === "audio"),
    revision: 0,
    extracted: false,
    frames: [],
  });
}

export async function importMedia(
  store: Store,
  audioDir: string,
  id: string,
  source: string,
) {
  const before = store.get<Meeting>("meetings", id);
  if (before.audio || before.segments.length || before.status === "recording")
    throw new Error("请新建会议导入，以保留现有原始资料");
  const ext = extname(source).toLowerCase();
  if (![".wav", ".mp3", ".m4a", ".mp4", ".ogg", ".webm", ".flac"].includes(ext))
    throw new Error("不支持此格式");
  const video = [".mp4", ".webm"].includes(ext)
    ? await probeVideo(source, AbortSignal.timeout(30000))
    : undefined;
  const name = `${id}${ext}`,
    destination = join(audioDir, name),
    temporary = `${destination}.${randomUUID()}.tmp`;
  await mkdir(audioDir, { recursive: true });
  try {
    await copyFile(source, temporary);
    const latest = store.get<Meeting>("meetings", id);
    if (latest.audio || latest.segments.length || latest.status === "recording")
      throw new Error("会议内容已改变，请新建会议导入");
    await rename(temporary, destination);
    latest.audio = name;
    latest.video = video;
    latest.mediaType = video ? "video" : "audio";
    latest.status = "ready";
    store.put("meetings", latest);
    return latest;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function captureFrame(
  source: string,
  directory: string,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<VisualFrame> {
  await mkdir(directory, { recursive: true });
  const id = randomUUID(),
    file = `${id}.jpg`;
  await mediaCommand(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-ss",
      String(start),
      "-i",
      resolve(source),
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "-update",
      "1",
      join(directory, file),
    ],
    signal,
  );
  if (!(await stat(join(directory, file))).size)
    throw new Error("未能读取该时刻的画面");
  return {
    id,
    file,
    start,
    end,
    title: "待识别画面",
    text: "",
    uncertain: "",
    excluded: false,
  };
}

export function visualDifference(a: Uint8Array, b: Uint8Array) {
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 22) changed++;
  return changed / a.length;
}

/** Low-resolution 2s scan detects transitions; full-resolution JPEGs retain fine text. */
export async function extractFrames(
  source: string,
  directory: string,
  duration: number,
  progress: (step: string) => void,
  signal?: AbortSignal,
) {
  if (duration > 6 * 3600)
    throw new Error("当前支持最多 6 小时录像分析，请分段导入");
  const sampleBytes = 160 * 90,
    times: number[] = [];
  let pending = Buffer.alloc(0),
    previous: Buffer | undefined,
    sample = 0,
    reported = -1;
  await mediaCommand(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      // Screen recordings can resize mid-stream. Restarting fps would reset
      // start_time and pad from zero again, breaking the sample * 2 timeline.
      // scale/pad evaluate each frame so they handle the changing dimensions.
      "-reinit_filter:v",
      "0",
      "-i",
      resolve(source),
      "-an",
      "-vf",
      "fps=fps=1/2:start_time=0,scale=160:90:force_original_aspect_ratio=decrease:eval=frame,pad=160:90:(ow-iw)/2:(oh-ih)/2:eval=frame,format=gray",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    signal,
    (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= sampleBytes) {
        const frame = pending.subarray(0, sampleBytes),
          time = sample++ * 2;
        pending = pending.subarray(sampleBytes);
        const last = times.at(-1) ?? -90;
        if (
          time < duration &&
          (!previous ||
            time - last >= 90 ||
            (time - last >= 4 && visualDifference(frame, previous) > 0.018))
        ) {
          times.push(time);
          previous = Buffer.from(frame);
          if (times.length > 600)
            throw new Error(
              "画面变化过多，超过 600 张分析上限，请缩短录像或分段导入",
            );
        }
        const percent = Math.min(100, Math.floor((time / duration) * 100));
        if (percent !== reported && percent % 5 === 0) {
          progress(`扫描画面变化 ${percent}%`);
          reported = percent;
        }
      }
    },
  );
  if (!times.length) throw new Error("录像没有可解码画面");
  const frames: VisualFrame[] = [];
  for (let i = 0; i < times.length; i++) {
    signal?.throwIfAborted();
    progress(`保存清晰画面 ${i + 1}/${times.length}`);
    // Sampling intervals are approximate, not proof the image persisted throughout.
    frames.push(
      await captureFrame(
        source,
        directory,
        times[i],
        times[i + 1] ?? duration,
        signal,
      ),
    );
  }
  return frames;
}

export async function videoAudio(
  audioDir: string,
  meeting: Meeting,
  signal?: AbortSignal,
) {
  if (!meeting.video) return join(audioDir, meeting.audio!);
  if (!meeting.video.hasAudio)
    throw new Error("此录像没有音轨，可直接识别画面并生成画面分析");
  const output = join(audioDir, `${meeting.id}-speech.wav`);
  if (existsSync(output) && (await stat(output)).size > 44) return output;
  const temporary = `${output}.tmp`;
  await mediaCommand(
    "ffmpeg",
    [
      "-nostdin",
      "-y",
      "-v",
      "error",
      "-i",
      join(audioDir, meeting.audio!),
      "-vn",
      "-map",
      "0:a:0",
      "-af",
      "aresample=16000:async=1:first_pts=0",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      temporary,
    ],
    signal,
  );
  await rename(temporary, output);
  return output;
}

export async function frameImage(directory: string, frame: VisualFrame) {
  if (!/^[a-f0-9-]{36}\.jpg$/i.test(frame.file))
    throw new Error("画面路径无效");
  const bytes = await readFile(join(directory, frame.file));
  if (bytes.length > 8 * 1024 * 1024)
    throw new Error("单张画面超过 8 MB，请降低源视频分辨率");
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
