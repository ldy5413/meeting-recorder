import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/store";
import { mediaLocation } from "../electron/media-location";

test("media locations include original and captured tracks, preserve missing paths, and reject foreign or traversing filenames", () => {
  const root = mkdtempSync(join(tmpdir(), "media-location-"));
  const store = new Store(join(root, "library.sqlite"));
  try {
    const m = store.createMeeting("Files", null);
    assert.deepEqual(mediaLocation(root, m).files, []);
    m.audio = `${m.id}.wav`;
    writeFileSync(join(root, m.audio), "original");
    writeFileSync(join(root, `${m.id}-mic.wav`), "mic");
    writeFileSync(join(root, `${m.id}-system.wav`), "system");
    const original = mediaLocation(root, m);
    assert.deepEqual(
      original.files.map((f) => f.kind),
      ["original", "microphone", "system"],
    );
    assert.equal(original.files[0].path, join(root, m.audio));
    assert.equal(original.files[0].bytes, 8);
    m.audio = `${m.id}.mp4`;
    m.mediaType = "video";
    const missing = mediaLocation(root, m).files;
    assert.equal(missing.length, 1);
    assert.equal(missing[0].exists, false);
    m.audio = null;
    m.capture = {
      status: "failed",
      sourceName: "Fixture",
      bytes: 7,
      nextSeq: 1,
    };
    writeFileSync(join(root, `${m.id}-capture.webm`), "pending");
    assert.equal(mediaLocation(root, m).files[0].kind, "pending");
    for (const name of [
      "../outside.mp4",
      `${randomUUID()}.mp4`,
      `${m.id}.mp4/../../outside`,
      `${m.id}.exe`,
    ]) {
      m.audio = name;
      assert.throws(() => mediaLocation(root, m), /文件名无效/);
    }
  } finally {
    store.close();
  }
});
