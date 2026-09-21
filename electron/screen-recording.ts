import {
  openSync,
  closeSync,
  fsyncSync,
  writeSync,
  ftruncateSync,
  statSync,
  existsSync,
} from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Id } from "../shared/types";
import { mediaCommand, probeVideo } from "./video";

export const capturePath = (directory: string, id: string) =>
  join(directory, `${Id.parse(id)}-capture.webm`);

/** Raw MediaRecorder bytes remain ordered and durable, including the initial WebM header. */
export class ScreenRecording {
  private fd: number | undefined;
  bytes = 0;
  nextSeq = 0;
  constructor(directory: string, id: string) {
    this.fd = openSync(capturePath(directory, id), "wx");
    fsyncSync(this.fd);
  }
  append(seq: number, data: Uint8Array) {
    if (this.fd === undefined) throw new Error("录像已停止");
    if (seq !== this.nextSeq)
      throw new Error("录像数据顺序不一致，已保留确认保存的部分");
    if (!data.length || data.length > 16 * 1024 * 1024)
      throw new Error("录像数据块超过限制");
    if (this.bytes + data.length > 24 * 1024 ** 3)
      throw new Error("录像已达到 24 GB 限制，请另建会议继续");
    try {
      let written = 0;
      while (written < data.length) {
        const n = writeSync(
          this.fd,
          data,
          written,
          data.length - written,
          this.bytes + written,
        );
        if (!n) throw new Error("磁盘未能写入录像");
        written += n;
      }
      fsyncSync(this.fd);
      this.bytes += data.length;
      this.nextSeq++;
    } catch (error) {
      // Never acknowledge a partial block. Recovery also uses the durable DB prefix.
      try {
        ftruncateSync(this.fd, this.bytes);
        fsyncSync(this.fd);
      } catch {
        /* Disk may be unavailable; recovery retries later. */
      }
      throw error;
    }
  }
  close() {
    if (this.fd !== undefined) {
      const fd = this.fd;
      this.fd = undefined;
      closeSync(fd);
    }
  }
}

export async function finalizeScreenRecording(
  directory: string,
  id: string,
  confirmedBytes: number,
  signal?: AbortSignal,
) {
  const raw = capturePath(directory, id);
  const destination = join(directory, `${id}.webm`);
  if (!existsSync(raw)) throw new Error("未找到待恢复的录像数据");
  if (
    !Number.isSafeInteger(confirmedBytes) ||
    confirmedBytes <= 0 ||
    confirmedBytes > statSync(raw).size
  )
    throw new Error("尚无完整保存的录像数据，或录像数据不完整");
  const fd = openSync(raw, "r+");
  try {
    ftruncateSync(fd, confirmedBytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const temporary = join(directory, `${id}-finalizing.webm`);
  try {
    await mediaCommand(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-fflags",
        "+discardcorrupt",
        "-i",
        raw,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-f",
        "webm",
        temporary,
      ],
      signal,
    );
    const video = await probeVideo(temporary, signal);
    if (!video) throw new Error("已保存数据没有可恢复的画面");
    // Verify decoding at both ends after rebuilding duration and seek metadata.
    for (const time of [0, Math.max(0, video.duration - 1)])
      await mediaCommand(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-xerror",
          "-ss",
          String(time),
          "-i",
          temporary,
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-f",
          "null",
          "-",
        ],
        signal,
      );
    const finalized = openSync(temporary, "r+");
    try {
      fsyncSync(finalized);
    } finally {
      closeSync(finalized);
    }
    await rename(temporary, destination);
    return { file: `${id}.webm`, video };
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
