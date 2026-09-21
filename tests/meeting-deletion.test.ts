import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/store";
import { Services } from "../electron/services";
import { backup, stageRestore } from "../electron/backup";
import type { Meeting, Job, Analysis } from "../shared/types";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "meeting-delete-"));
  const library = join(root, "library");
  mkdirSync(join(library, "audio"), { recursive: true });
  const store = new Store(join(library, "library.sqlite"));
  const project = store.createProject("删除测试");
  const created = store.createMeeting("合成会议", project.id);
  const meeting = store.saveTranscript(
    created.id,
    0,
    [
      {
        id: randomUUID(),
        start: 0,
        end: 3,
        speaker: "speaker-1",
        text: "决定采用合成方案。",
      },
    ],
    {},
  );
  meeting.audio = `${meeting.id}.wav`;
  writeFileSync(
    join(library, "audio", meeting.audio),
    "synthetic media for retention test",
  );
  const analysis: Analysis = {
    id: randomUUID(),
    version: meeting.version,
    created: new Date().toISOString(),
    raw: "synthetic fixture",
    editedNotes: null,
    claims: [
      {
        kind: "decision",
        text: "采用合成方案",
        owner: null,
        due: null,
        change: "new",
        targetId: null,
        evidence: [
          {
            segmentId: meeting.segments[0].id,
            quote: meeting.segments[0].text,
          },
        ],
      },
    ],
  };
  meeting.analyses.push(analysis);
  store.put("meetings", meeting);
  return { root, library, store, meeting, analysis };
}

test("deletion excludes retrieval but preserves project evidence, versions, media and restoration", () => {
  const { store, meeting, analysis, library } = fixture();
  try {
    const record = store.accept(meeting.id, analysis.id, 0);
    const updated = store.saveTranscript(
      meeting.id,
      meeting.version,
      meeting.segments.map((s) => ({ ...s, text: "校对后的合成方案。" })),
      {},
    );
    assert.equal(store.search("合成", null, null, "", "").length, 1);
    const deleted = store.deleteMeeting(meeting.id);
    assert.ok(deleted.deletedAt);
    assert.equal(store.search("合成", null, null, "", "").length, 0);
    assert.equal(store.search("历史总结", null, meeting.id, "", "").length, 0);
    assert.deepEqual(store.get("records", record.id), record);
    assert.equal(store.resolveEvidence(record.evidence[0]).version, 1);
    assert.equal(
      readFileSync(join(library, "audio", meeting.audio!), "utf8"),
      "synthetic media for retention test",
    );
    assert.throws(
      () => store.saveTranscript(meeting.id, updated.version, [], {}),
      /会议已删除/,
    );
    assert.throws(() => store.accept(meeting.id, analysis.id, 0), /会议已删除/);
    const service = new Services(
      store,
      join(library, "audio"),
      () => ({
        baseUrl: "http://localhost",
        asrUrl: "http://localhost",
        model: "test",
        consent: false,
        contextBudget: 32768,
      }),
      () => "",
    );
    assert.throws(() => service.start(meeting.id, "analyze"), /会议已删除/);
    const failed: Job = {
      id: randomUUID(),
      meetingId: meeting.id,
      kind: "analyze",
      status: "failed",
      step: "synthetic",
      error: "synthetic",
      remoteId: null,
      version: updated.version,
      created: new Date().toISOString(),
    };
    store.put("jobs", failed);
    assert.throws(() => service.retry(failed.id), /会议已删除/);
    assert.deepEqual(store.restoreMeeting(meeting.id), updated);
    assert.equal(store.search("合成", null, null, "", "").length, 1);
  } finally {
    store.close();
  }
});

test("active recording, finalizing capture and queued jobs prevent deletion", () => {
  const { store, meeting } = fixture();
  try {
    store.put("meetings", { ...meeting, status: "recording" } as Meeting);
    assert.throws(() => store.deleteMeeting(meeting.id), /录制和后台任务/);
    store.put("meetings", {
      ...meeting,
      capture: {
        status: "finalizing",
        sourceName: "synthetic",
        bytes: 0,
        nextSeq: 0,
      },
    } as Meeting);
    assert.throws(() => store.deleteMeeting(meeting.id), /录制和后台任务/);
    store.put("meetings", meeting);
    const job: Job = {
      id: randomUUID(),
      meetingId: meeting.id,
      kind: "analyze",
      status: "queued",
      step: "test",
      error: null,
      remoteId: null,
      version: meeting.version,
      created: new Date().toISOString(),
    };
    store.put("jobs", job);
    assert.throws(() => store.deleteMeeting(meeting.id), /录制和后台任务/);
    store.put("jobs", { ...job, status: "cancelled" } as Job);
    assert.ok(store.deleteMeeting(meeting.id).deletedAt);
  } finally {
    store.close();
  }
});

test("deleted meetings survive restart and backup with original media and can be restored", async () => {
  const { store, meeting, root, library } = fixture();
  let restored: Store | undefined;
  try {
    const deleted = store.deleteMeeting(meeting.id);
    const file = join(root, "backup.tar.gz");
    await backup(store, library, file);
    const staging = await stageRestore(file, library);
    restored = new Store(join(staging, "library.sqlite"));
    restored.recover();
    assert.deepEqual(restored.get<Meeting>("meetings", meeting.id), deleted);
    assert.equal(
      readFileSync(join(staging, "audio", meeting.audio!), "utf8"),
      "synthetic media for retention test",
    );
    assert.deepEqual(restored.restoreMeeting(meeting.id), meeting);
  } finally {
    restored?.close();
    store.close();
  }
});
