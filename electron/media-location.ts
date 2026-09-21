import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  Id,
  type Meeting,
  type MediaLocation,
  type MediaFileKind,
} from "../shared/types";

/** Resolve only files owned by a meeting; renderer requests never supply a path. */
export function mediaLocation(
  directory: string,
  meeting: Meeting,
): MediaLocation {
  const id = Id.parse(meeting.id);
  const result: MediaLocation = { directory: resolve(directory), files: [] };
  const add = (
    kind: MediaFileKind,
    label: string,
    name: string,
    required = false,
  ) => {
    const path = join(result.directory, name);
    let bytes: number | undefined;
    try {
      const file = statSync(path);
      if (file.isFile()) bytes = file.size;
    } catch {
      // Keep the expected location visible even if a file was moved or removed.
    }
    if (required || bytes !== undefined)
      result.files.push({
        kind,
        label,
        path,
        exists: bytes !== undefined,
        bytes,
      });
  };
  if (meeting.audio) {
    if (
      !/^[a-f0-9-]{36}\.(wav|mp3|m4a|mp4|ogg|webm|flac)$/i.test(
        meeting.audio,
      ) ||
      meeting.audio.slice(0, 36).toLowerCase() !== id.toLowerCase()
    )
      throw new Error("会议媒体文件名无效");
    add(
      "original",
      meeting.video || meeting.mediaType === "video" ? "原始录像" : "原始录音",
      meeting.audio,
      true,
    );
    if (
      !meeting.video &&
      meeting.mediaType !== "video" &&
      meeting.audio.endsWith(".wav")
    ) {
      add("microphone", "麦克风音轨", `${id}-mic.wav`);
      add("system", "系统声音音轨", `${id}-system.wav`);
    }
  }
  if (meeting.capture && meeting.capture.status !== "complete")
    add("pending", "待整理录像数据", `${id}-capture.webm`, true);
  return result;
}
