import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/store";
import { Services } from "../electron/services";
import type { Job, Meeting } from "../shared/types";
import { speakerCount, speakerIds, speakerLabel } from "../shared/speakers";

test("speaker repair preserves edits, names and history; rejects changed text, conflicting names and stale versions", async () => {
  const root = mkdtempSync(join(tmpdir(), "speaker-repair-"));
  const store = new Store(join(root, "db.sqlite"));
  let mode = "ok";
  let uploads = 0;
  let uploaded = "";
  let meeting: Meeting;
  const remoteId = randomUUID();
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/health") {
      res.end(
        JSON.stringify(
          mode === "old-service"
            ? {}
            : {
                speaker_resolution_version: 1,
                speaker_count_hint: mode !== "count-unsupported",
              },
        ),
      );
    } else if (req.method === "POST" && req.url === "/jobs") {
      uploads++;
      uploaded = "";
      for await (const chunk of req) uploaded += chunk;
      res.end(JSON.stringify({ id: remoteId }));
    } else if (req.url === `/jobs/${remoteId}`) {
      if (mode === "stale")
        store.saveTranscript(
          meeting.id,
          meeting.version,
          meeting.segments,
          meeting.speakers,
        );
      res.end(
        JSON.stringify({
          status: "complete",
          segments: meeting.segments.map((s) => ({
            ...s,
            speaker: s.text === "[Silence]" ? "non-speech" : "speaker-1",
            text: mode === "changed-text" ? "rewritten" : s.text,
          })),
        }),
      );
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const services = new Services(
    store,
    root,
    () => ({
      asrUrl: `http://127.0.0.1:${port}`,
      baseUrl: "http://127.0.0.1:1",
      model: "",
      consent: true,
      contextBudget: 32768,
    }),
    () => "",
  );
  try {
    for (mode of [
      "ok",
      "ok-with-count",
      "count-unsupported",
      "changed-text",
      "conflicting-names",
      "stale",
      "old-service",
    ]) {
      meeting = store.createMeeting(mode, null);
      meeting.audio = `${meeting.id}.wav`;
      writeFileSync(join(root, meeting.audio), "audio");
      store.put("meetings", meeting);
      meeting = store.saveTranscript(
        meeting.id,
        0,
        [0, 1, 2, 3].map((i) => ({
          id: randomUUID(),
          speaker: `chunk-${(i % 2) + 1}:speaker-0`,
          start: i * 5,
          end: i * 5 + 4,
          text: i < 2 ? "已校对文字" : "[Silence]",
        })),
        {
          "chunk-1:speaker-0": "张三",
          ...(mode === "conflicting-names"
            ? { "chunk-2:speaker-0": "李四" }
            : {}),
        },
      );
      const beforeUploads = uploads;
      const expectedSpeakers =
        mode === "ok-with-count" || mode === "count-unsupported"
          ? 6
          : undefined;
      const job = services.start(
        meeting.id,
        "speakers",
        undefined,
        undefined,
        false,
        undefined,
        expectedSpeakers,
      );
      const deadline = Date.now() + 5000;
      while (services.controllers.size) {
        if (Date.now() > deadline) throw new Error("Timed out");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const result = store.get<Job>("jobs", job.id);
      const saved = store.get<Meeting>("meetings", meeting.id);
      assert.equal(
        result.status,
        mode.startsWith("ok") ? "complete" : "failed",
        result.error ?? "",
      );
      if (mode.startsWith("ok")) {
        assert.match(uploaded, /name="task"\r\n\r\nspeakers/);
        assert.match(uploaded, /已校对文字/);
        assert.equal(result.expectedSpeakers, expectedSpeakers);
        if (expectedSpeakers !== undefined)
          assert.match(uploaded, /name="expected_speakers"\r\n\r\n6/);
        else assert.doesNotMatch(uploaded, /name="expected_speakers"/);
        assert.deepEqual(saved.speakers, { "speaker-1": "张三" });
        assert.equal(saved.version, 2);
        assert.deepEqual(
          saved.segments.map(({ speaker, ...s }) => s),
          meeting.segments.map(({ speaker, ...s }) => s),
        );
        assert.equal(
          store.db
            .prepare("SELECT COUNT(*) AS n FROM versions WHERE meeting_id=?")
            .get(meeting.id)!.n,
          2,
        );
      } else {
        assert.deepEqual(saved.segments, meeting.segments);
        if (mode === "old-service" || mode === "count-unsupported")
          assert.equal(uploads, beforeUploads);
      }
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test("speaker display excludes non-speech and does not count unresolved voices as people", () => {
  const items = [
    "speaker-1",
    "speaker-1",
    "speaker-2",
    "non-speech",
    "unresolved-1",
  ].map((speaker) => ({
    id: randomUUID(),
    speaker,
    start: 0,
    end: 1,
    text: "",
  }));
  assert.equal(speakerCount(items), 2);
  assert.equal(speakerIds(items).length, 3);
  assert.equal(speakerLabel("speaker-1"), "说话人 1");
  assert.equal(speakerLabel("unresolved-1"), "待确认 1");
  assert.equal(
    speakerCount([...items, { ...items[0], speaker: "unknown" }]),
    2,
  );
  assert.equal(speakerLabel("unknown"), "待确认");
});
