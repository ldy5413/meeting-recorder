import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  appendFileSync,
  statSync,
  closeSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  ScreenRecording,
  capturePath,
  finalizeScreenRecording,
} from "../electron/screen-recording";
import { mediaCommand, captureFrame } from "../electron/video";
import { backup, stageRestore } from "../electron/backup";
import { Store } from "../electron/store";
import type { Meeting } from "../shared/types";

test("write failure never advances the confirmed byte count; interrupted capture survives backup", async () => {
  const root = mkdtempSync(join(tmpdir(), "screen-failure-")),
    library = join(root, "library"),
    audio = join(library, "audio");
  mkdirSync(audio, { recursive: true });
  const store = new Store(join(library, "library.sqlite"));
  const meeting = store.createMeeting("Interrupted", null);
  const recording = new ScreenRecording(audio, meeting.id);
  try {
    recording.append(0, new Uint8Array([1, 2, 3]));
    closeSync((recording as any).fd);
    assert.throws(() => recording.append(1, new Uint8Array([4, 5])), /EBADF/);
    assert.equal(recording.bytes, 3);
    assert.equal(recording.nextSeq, 1);
    meeting.capture = {
      status: "failed",
      sourceName: "Fixture",
      bytes: 3,
      nextSeq: 1,
      error: "disk write failed",
    };
    meeting.status = "interrupted";
    store.put("meetings", meeting);
    const archive = join(root, "backup.tar.gz");
    await backup(store, library, archive);
    const restoredPath = await stageRestore(archive, library);
    const restored = new Store(join(restoredPath, "library.sqlite"));
    try {
      assert.equal(
        restored.get<Meeting>("meetings", meeting.id).capture?.bytes,
        3,
      );
      assert.deepEqual(
        [...readFileSync(capturePath(join(restoredPath, "audio"), meeting.id))],
        [1, 2, 3],
      );
    } finally {
      restored.close();
    }
  } finally {
    store.close();
  }
});

test("screen bytes are ordered, bounded and closed explicitly", () => {
  const root = mkdtempSync(join(tmpdir(), "screen-journal-")),
    id = randomUUID();
  const recording = new ScreenRecording(root, id);
  try {
    recording.append(0, new Uint8Array([1, 2, 3]));
    assert.throws(() => recording.append(0, new Uint8Array([4])));
    assert.throws(() => recording.append(1, new Uint8Array()));
    assert.throws(() =>
      recording.append(1, new Uint8Array(16 * 1024 * 1024 + 1)),
    );
    assert.equal(recording.bytes, 3);
    assert.equal(recording.nextSeq, 1);
    recording.append(1, new Uint8Array([4, 5]));
  } finally {
    recording.close();
  }
  assert.deepEqual([...readFileSync(capturePath(root, id))], [1, 2, 3, 4, 5]);
  assert.throws(() => recording.append(2, new Uint8Array([6])));
  assert.throws(() => capturePath(root, "../escape"));
});

test("interrupted WebM restores only the confirmed prefix and becomes seekable", async (t) => {
  try {
    await mediaCommand("ffmpeg", ["-version"]);
  } catch {
    t.skip("FFmpeg not installed");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "screen-recover-")),
    id = randomUUID(),
    fixture = join(root, "fixture.webm");
  await mediaCommand("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=10:duration=6",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=1000:sample_rate=48000:duration=6",
    "-c:v",
    "libvpx",
    "-deadline",
    "realtime",
    "-c:a",
    "libopus",
    "-cluster_time_limit",
    "1000",
    "-live",
    "1",
    fixture,
  ]);
  const data = readFileSync(fixture),
    recording = new ScreenRecording(root, id);
  for (let i = 0, seq = 0; i < data.length; i += 16384)
    recording.append(seq++, data.subarray(i, i + 16384));
  recording.close();
  appendFileSync(capturePath(root, id), Buffer.alloc(10000, 0xff));
  const result = await finalizeScreenRecording(root, id, data.length);
  assert.equal(statSync(capturePath(root, id)).size, data.length);
  assert.ok(Math.abs(result.video.duration - 6) < 0.2);
  assert.equal(result.video.hasAudio, true);
  const frame = await captureFrame(
    join(root, result.file),
    join(root, "frames"),
    4.5,
    5,
  );
  assert.ok(statSync(join(root, "frames", frame.file)).size > 0);
  const truncatedId = randomUUID(),
    cut = Math.floor(data.length * 0.72);
  const interrupted = new ScreenRecording(root, truncatedId);
  interrupted.append(0, data.subarray(0, cut));
  interrupted.close();
  const recovered = await finalizeScreenRecording(root, truncatedId, cut);
  assert.ok(recovered.video.duration > 1 && recovered.video.duration < 6);
});
