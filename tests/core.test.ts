import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as tar from "tar";
import { Store, checkEvidence, validateClaims } from "../electron/store";
import { Recording, repairWav, recoverRecording } from "../electron/audio";
import { backup, stageRestore } from "../electron/backup";
import { subtitle } from "../electron/export";
import { batches, endpoint, Services } from "../electron/services";
import type { Meeting, Claim, RecordItem, Job } from "../shared/types";
import { contextOf } from "../shared/analysis";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "meeting-test-"));
  const library = join(root, "library");
  mkdirSync(join(library, "audio"), { recursive: true });
  const store = new Store(join(library, "library.sqlite"));
  const project = store.createProject("项目甲");
  const meeting = store.createMeeting("设计讨论", project.id);
  return { root, library, store, project, meeting };
}
test("project defaults, isolated meeting settings, template snapshots and backup roundtrip", async () => {
  const { store, library, root, project, meeting } = fixture();
  try {
    const template = store.saveTemplate("周报", "按人整理，不推断身份");
    const context = {
      ...contextOf(),
      background: "待讨论项目，不代表已决定",
      keywords: ["XRD"],
      templateId: template.id,
    };
    store.configure("projects", project.id, context);
    assert.equal(
      store.get<Meeting>("meetings", meeting.id).context!.background,
      "",
    );
    const copied = store.createMeeting("新周会", project.id);
    assert.deepEqual(copied.context, context);
    store.configure("meetings", copied.id, {
      ...context,
      background: "单场背景",
    });
    assert.deepEqual(store.get<any>("projects", project.id).context, context);
    const snapshot = store.snapshot(store.get<Meeting>("meetings", copied.id));
    store.saveTemplate("改名", "改要求", template.id);
    store.deleteTemplate(template.id);
    assert.equal(snapshot.template.requirements, "按人整理，不推断身份");
    assert.throws(() => store.snapshot(copied), /模板已删除/);
    store.configure("projects", project.id, {
      ...context,
      templateId: "weekly",
    });
    store.reloadDefaults(copied.id);
    assert.equal(
      store.get<Meeting>("meetings", copied.id).context!.templateId,
      "weekly",
    );
    const custom = store.saveTemplate("恢复模板", "按主题整理");
    const archive = join(root, "context-backup.tar.gz");
    await backup(store, library, archive);
    const staging = await stageRestore(archive, library);
    const restored = new Store(join(staging, "library.sqlite"));
    assert.deepEqual(restored.templates(), store.templates());
    assert.ok(restored.templates().some((t) => t.id === custom.id));
    assert.deepEqual(
      restored.get("meetings", copied.id),
      store.get("meetings", copied.id),
    );
    restored.close();
    const legacy = { ...meeting };
    delete legacy.context;
    assert.equal(store.snapshot(legacy).template.id, "project-progress");
  } finally {
    store.close();
  }
});
test("historical meeting date drives retrieval instead of import date", () => {
  const { store, project } = fixture();
  try {
    const m = store.createMeeting(
      "历史会议",
      project.id,
      "2026-07-10T10:00:00-07:00",
    );
    store.saveTranscript(
      m.id,
      0,
      [
        {
          id: randomUUID(),
          start: 0,
          end: 1,
          speaker: "s1",
          text: "历史设计决定采用 SQLite",
        },
      ],
      {},
    );
    assert.equal(
      store.search("SQLite", project.id, null, "2026-07-01", "2026-07-31")
        .length,
      1,
    );
    assert.equal(
      store.search("SQLite", project.id, null, "2026-08-01", "2026-08-31")
        .length,
      0,
    );
    assert.notEqual(m.created, m.occurredAt);
  } finally {
    store.close();
  }
});
test("transcript versions, evidence guards, stale proposals, search and SRT", () => {
  const { store, meeting, project } = fixture();
  try {
    const segment = {
      id: randomUUID(),
      start: 1.125,
      end: 4.25,
      speaker: "s1",
      text: "张三负责 API 迁移，下周五完成。",
    };
    const m = store.saveTranscript(meeting.id, 0, [segment], {}, "raw output");
    const claim: Claim = {
      kind: "todo",
      text: "API 迁移",
      owner: "张三",
      due: "下周五",
      evidence: [{ segmentId: segment.id, quote: segment.text }],
      targetId: null,
      change: "new",
    };
    validateClaims([claim], m.segments, []);
    assert.throws(() =>
      checkEvidence([{ segmentId: segment.id, quote: "不存在" }], m.segments),
    );
    assert.throws(() =>
      validateClaims([{ ...claim, owner: "李四" }], m.segments, []),
    );
    const a = {
      id: randomUUID(),
      created: new Date().toISOString(),
      version: 1,
      claims: [claim],
      raw: "raw",
      editedNotes: null,
    };
    m.analyses.push(a);
    store.put("meetings", m);
    const r = store.accept(m.id, a.id, 0);
    assert.equal(r.owner, "张三");
    assert.throws(() => store.accept(m.id, a.id, 0));
    assert.equal(store.search("迁移", project.id, null, "", "").length, 1);
    assert.equal(store.search("API", null, m.id, "2099-01-01", "").length, 0);
    const edited = store.saveTranscript(
      m.id,
      1,
      [{ ...segment, text: "修改后的原文" }],
      {},
    );
    assert.equal(edited.analyses[0].raw, "raw");
    assert.equal(store.resolveEvidence(claim.evidence[0]).version, 1);
    assert.throws(() => store.accept(m.id, a.id, 0), /过期/);
    assert.throws(() => store.saveTranscript(m.id, 1, [segment], {}), /已更新/);
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM versions").get()?.n,
      2,
    );
    assert.match(subtitle(m), /00:00:01,125 --> 00:00:04,250/);
  } finally {
    store.close();
  }
});
test("three meetings: propose, continue, complete and history remain local", () => {
  const { store, project, meeting } = fixture();
  try {
    let target: string | null = null;
    for (const [i, change] of ["new", "continue", "complete"].entries()) {
      const m = i ? store.createMeeting(`会议 ${i}`, project.id) : meeting;
      const s = {
        id: randomUUID(),
        start: 0,
        end: 5,
        speaker: "s1",
        text: i === 2 ? "API 迁移已经完成。" : "继续推进 API 迁移。",
      };
      const updated = store.saveTranscript(m.id, 0, [s], {});
      const claim: Claim = {
        kind: "todo",
        text: "API 迁移",
        owner: null,
        due: null,
        evidence: [{ segmentId: s.id, quote: s.text }],
        targetId: target,
        change: change as Claim["change"],
      };
      const a = {
        id: randomUUID(),
        created: new Date().toISOString(),
        version: 1,
        claims: [claim],
        raw: "",
        editedNotes: null,
      };
      updated.analyses = [a];
      store.put("meetings", updated);
      target = store.accept(m.id, a.id, 0).id;
    }
    const records = store.all<RecordItem>("records");
    assert.equal(records.length, 1);
    assert.equal(records[0].status, "complete");
    assert.equal(records[0].history.length, 3);
  } finally {
    store.close();
  }
});
test("PCM chunks are aligned, durable, recoverable and sequence checked", () => {
  const dir = mkdtempSync(join(tmpdir(), "audio-test-")),
    paths = ["mic", "system", "mix"].map((x) => join(dir, `${x}.wav`));
  const r = new Recording(paths, 48000);
  const mic = Buffer.alloc(96000),
    system = Buffer.alloc(96000);
  mic.writeInt16LE(1000, 0);
  system.writeInt16LE(3000, 0);
  r.append(0, mic, system);
  assert.throws(() => r.append(2, mic, system), /顺序/);
  r.close();
  const mixed = readFileSync(paths[2]);
  assert.equal(mixed.readInt16LE(44), 4000);
  assert.equal(mixed.readUInt32LE(40), 96000);
  appendFileSync(paths[2], Buffer.from([1, 2, 3]));
  repairWav(paths[2], 48000);
  assert.equal(readFileSync(paths[2]).readUInt32LE(40), 96002);
});
test("mix preserves solo sources and saturates overlapping peaks, including recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "mix-level-"));
  const paths = ["mic", "system", "mix"].map((x) => join(dir, `${x}.wav`));
  const mic = Buffer.alloc(10),
    system = Buffer.alloc(10);
  [1200, 0, 30000, -30000, 0].forEach((v, i) => mic.writeInt16LE(v, i * 2));
  [0, -2400, 30000, -30000, 0].forEach((v, i) => system.writeInt16LE(v, i * 2));
  const recording = new Recording(paths, 48000);
  recording.append(0, mic, system);
  recording.close();
  const expected = [1200, -2400, 32767, -32768, 0];
  const samples = () =>
    expected.map((_, i) => readFileSync(paths[2]).readInt16LE(44 + i * 2));
  assert.deepEqual(samples(), expected);
  recoverRecording(paths[0], paths[1], paths[2], 48000);
  assert.deepEqual(samples(), expected);
});

test("backup roundtrip preserves audio, edited transcript and foreign evidence", async () => {
  const { store, library, root, meeting } = fixture();
  try {
    const m = store.saveTranscript(
      meeting.id,
      0,
      [
        {
          id: randomUUID(),
          start: 0,
          end: 1,
          text: "恢复校对内容",
          speaker: "a",
        },
      ],
      { a: "主持人" },
    );
    m.audio = `${m.id}.wav`;
    store.put("meetings", m);
    writeFileSync(
      join(library, "audio", m.audio),
      Buffer.from("audio fixture"),
    );
    const archive = join(root, "backup.tar.gz");
    await backup(store, library, archive);
    const staging = await stageRestore(archive, library);
    const restored = new Store(join(staging, "library.sqlite"));
    assert.deepEqual(restored.get("meetings", m.id), m);
    assert.equal(
      readFileSync(join(staging, "audio", m.audio), "utf8"),
      "audio fixture",
    );
    restored.close();
  } finally {
    store.close();
  }
});
test("restore rejects unexpected archive paths without changing the original library", async () => {
  const { root, library, store, meeting } = fixture();
  try {
    const input = join(root, "input");
    mkdirSync(input);
    writeFileSync(join(input, "unexpected.txt"), "invalid");
    const archive = join(root, "invalid.tar.gz");
    await tar.c({ file: archive, cwd: input, gzip: true }, ["unexpected.txt"]);
    await assert.rejects(() => stageRestore(archive, library), /路径/);
    assert.equal(
      store.get<Meeting>("meetings", meeting.id).title,
      meeting.title,
    );
  } finally {
    store.close();
  }
});
test("crash between source writes rebuilds the mixed track without losing captured microphone samples", () => {
  const root = mkdtempSync(join(tmpdir(), "recovery-"));
  const paths = ["mic", "system", "mixed"].map((n) => join(root, `${n}.wav`));
  const r = new Recording(paths, 48000);
  r.append(0, Buffer.alloc(4), Buffer.alloc(4));
  r.close();
  const tail = Buffer.alloc(4);
  tail.writeInt16LE(2000, 0);
  appendFileSync(paths[0], tail);
  recoverRecording(paths[0], paths[1], paths[2], 48000);
  const mixed = readFileSync(paths[2]);
  assert.equal(mixed.readUInt32LE(40), 8);
  assert.equal(mixed.readInt16LE(48), 2000);
  assert.equal(readFileSync(paths[0]).readUInt32LE(40), 8);
});
test("budget and URL boundaries reject unsafe or impossible requests", () => {
  assert.equal(
    endpoint("https://example.org/v1/", "chat/completions"),
    "https://example.org/v1/chat/completions",
  );
  assert.throws(() => endpoint("http://example.org", "jobs"));
  assert.throws(() => endpoint("https://a:b@example.org", "jobs"));
  assert.deepEqual(batches([1, 2, 3], 2), [[1, 2], [3]]);
  assert.throws(() => batches(["oversize"], 2));
});
test("restart marks in-flight steps as retriable without removing audio", () => {
  const { store, meeting } = fixture();
  const m = {
    ...meeting,
    status: "recording" as const,
    audio: `${meeting.id}.wav`,
  };
  store.put("meetings", m);
  const j: Job = {
    id: randomUUID(),
    meetingId: m.id,
    kind: "transcribe",
    status: "running",
    step: "等待转录",
    error: null,
    remoteId: randomUUID(),
    version: 0,
    created: "now",
  };
  store.put("jobs", j);
  store.recover();
  assert.equal(store.get<Meeting>("meetings", m.id).status, "interrupted");
  assert.equal(store.get<Job>("jobs", j.id).remoteId, j.remoteId);
  assert.equal(store.get<Job>("jobs", j.id).status, "failed");
  store.close();
});
test("failed model output does not persist analysis or official records", async () => {
  const { store, meeting, library } = fixture();
  const m = store.saveTranscript(
    meeting.id,
    0,
    [{ id: randomUUID(), start: 0, end: 1, text: "讨论 API", speaker: "a" }],
    {},
  );
  const services = new Services(
    store,
    join(library, "audio"),
    () => ({
      asrUrl: "http://localhost:8765",
      baseUrl: "https://example.org",
      model: "test",
      contextBudget: 32768,
      consent: true,
    }),
    () => "",
  );
  services.chat = async () => ({
    raw: "{}",
    value: {
      claims: [
        {
          kind: "todo",
          text: "虚构",
          owner: null,
          due: null,
          targetId: null,
          change: "new",
          evidence: [{ segmentId: randomUUID(), quote: "不存在" }],
        },
      ],
    },
  });
  const job = services.start(m.id, "analyze");
  while (services.controllers.size) await new Promise((r) => setTimeout(r, 5));
  assert.equal(store.get<Job>("jobs", job.id).status, "failed");
  assert.equal(store.get<Meeting>("meetings", m.id).analyses.length, 0);
  assert.equal(store.all("records").length, 0);
  store.close();
});
