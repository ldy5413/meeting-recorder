import { languageHttpFixture } from "./language-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildWeeklySections,
  weeklyPeople,
  weeklySourceSpeakers,
} from "../electron/weekly-sections";
import { Store } from "../electron/store";
import { Services } from "../electron/services";
import { analysisMarkdown, contextOf } from "../shared/analysis";
import type { AnalysisSection, Claim, Job, Meeting } from "../shared/types";

test("unnamed speakers group by cited voice, confirmed names take priority, and visual or mixed sources stay unconfirmed", () => {
  const segments = ["speaker-1", "speaker-2", "speaker-3", "unresolved-1"].map(
    (speaker) => ({
      id: randomUUID(),
      start: 0,
      end: 2,
      speaker,
      text: "我本周整理了测试记录。",
    }),
  );
  const speakers = { "speaker-3": "张三" };
  const claims: Claim[] = [[0], [1], [2], [0, 1], [], [3], [0]].map(
    (indices, i) => ({
      kind: "topic",
      text: `会议记录 ${i}`,
      owner: null,
      due: null,
      change: "new",
      targetId: null,
      evidence: indices.length
        ? indices.map((index) => ({
            segmentId: segments[index].id,
            quote: segments[index].text,
          }))
        : [{ frameId: randomUUID(), quote: "图示测试数据" }],
    }),
  );
  const before = JSON.stringify(claims);
  const sources = weeklySourceSpeakers(claims, segments, speakers);
  assert.deepEqual(sources, [
    "speaker-1",
    "speaker-2",
    null,
    null,
    null,
    null,
    "speaker-1",
  ]);
  const people = weeklyPeople(claims, speakers, sources);
  assert.deepEqual(people, [
    "__unconfirmed__",
    "张三",
    "speaker-1",
    "speaker-2",
  ]);
  const { sections, personAdjustments } = buildWeeklySections(
    {
      assignments: claims.map((_, index) => ({
        index,
        column: "progress",
        person: [
          null,
          "speaker-2 (Guessed)",
          "张三",
          "speaker-1",
          "speaker-2",
          "unresolved-1",
          "speaker-2",
        ][index],
      })),
    },
    claims.length,
    people,
    sources,
  );
  assert.deepEqual(
    sections.map((s) => [s.title, s.children[0].claimIndices]),
    [
      ["speaker-1", [0, 6]],
      ["speaker-2", [1]],
      ["张三", [2]],
      ["未确认人员", [3, 4, 5]],
    ],
  );
  assert.equal(JSON.stringify(claims), before);
  assert.equal(
    personAdjustments.find((a) => a.claimIndex === 1)!.originalPerson,
    "speaker-2 (Guessed)",
  );
  assert.equal(
    personAdjustments.find((a) => a.claimIndex === 6)!.person,
    "speaker-1",
  );
});

test("weekly assignments preserve indices and merge anonymous or guessed names into unconfirmed people", () => {
  const input = {
    assignments: [
      { index: 4, person: "李四", column: "progress" },
      { index: 0, person: "speaker-1", column: "progress" },
      { index: 1, person: "speaker-5 (Alice)", column: "plans" },
      { index: 2, person: "Bob", column: "progress" },
      { index: 3, person: null, column: "blockers" },
      { index: 5, person: "李四", column: "plans" },
    ],
  };
  const original = JSON.stringify(input);
  const result = buildWeeklySections(input, 6, ["未确认人员", "李四"]);
  assert.equal(JSON.stringify(input), original);
  assert.deepEqual(result.sections, [
    {
      title: "未确认人员",
      claimIndices: [],
      children: [
        { title: "本周进展", claimIndices: [0, 2], children: [] },
        { title: "下周计划", claimIndices: [1], children: [] },
        { title: "阻塞与协助事项", claimIndices: [3], children: [] },
      ],
    },
    {
      title: "李四",
      claimIndices: [],
      children: [
        { title: "本周进展", claimIndices: [4], children: [] },
        { title: "下周计划", claimIndices: [5], children: [] },
      ],
    },
  ]);
  assert.deepEqual(
    result.personAdjustments.map((a) => a.originalPerson),
    ["speaker-1", "speaker-5 (Alice)", "Bob"],
  );
  assert.deepEqual(
    weeklyPeople([{ owner: "王五" }, { owner: "speaker-3" }] as Claim[], {
      a: " 李四 ",
      b: "李四",
      c: "unknown",
    }),
    ["__unconfirmed__", "李四", "王五"],
  );
});

test("weekly assignment validation rejects missing, duplicate, out-of-range indices and unsupported columns", () => {
  const item = { index: 0, person: null, column: "progress" };
  const parse = (assignments: unknown[]) =>
    buildWeeklySections({ assignments }, 2, ["未确认人员"]);
  assert.throws(() => parse([item]), /遗漏 \[1\]/);
  assert.throws(() => parse([item, item, { ...item, index: 1 }]), /重复 \[0\]/);
  assert.throws(() => parse([item, { ...item, index: 2 }]), /越界 \[2\]/);
  assert.throws(() =>
    parse([item, { ...item, index: 1, column: "项目已完成" }]),
  );
  assert.throws(() => parse([item, { ...item, index: 1.5 }]));
  assert.throws(() => buildWeeklySections({ sections: [] }, 2, ["未确认人员"]));
  assert.deepEqual(
    buildWeeklySections({ assignments: [] }, 0, []).sections,
    [],
  );
});

test("weekly retry preserves verified batches, checks person attribution and merges multiple chapter batches without losing evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "weekly-sections-"));
  const store = new Store(join(root, "db.sqlite"));
  const meeting = store.createMeeting("Weekly fixture", null);
  const segments = Array.from({ length: 5 }, (_, i) => ({
    id: randomUUID(),
    start: i * 10,
    end: i * 10 + 5,
    speaker: i % 2 ? "speaker-2" : "speaker-1",
    text:
      `我本周完成模块${i}的测试。` +
      "检查采样率、输入尺寸和异常情况。".repeat(40),
  }));
  store.saveTranscript(meeting.id, 0, segments, {
    "speaker-1": "张三",
    "speaker-2": "李四",
  });
  store.configure("meetings", meeting.id, {
    ...contextOf(),
    templateId: "weekly",
  });
  let generations = 0,
    organizations = 0,
    chapterReviews = 0;
  let rejectWrongPerson = true;
  const server = createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const data = JSON.parse(JSON.parse(body).messages[1].content);
      if (languageHttpFixture(data, response)) return;
      let value: unknown;
      if (data.sections) {
        chapterReviews++;
        if (rejectWrongPerson) {
          assert.equal(data.sections[0].title, "李四");
          rejectWrongPerson = false;
          value = {
            supported: false,
            reason: "该工作是张三本人完成，不能归属李四",
          };
        } else {
          assert.ok(
            data.sections.every(
              (s: AnalysisSection) => s.claimIndices.length === 0,
            ),
          );
          value = { supported: true };
        }
      } else if (data.claims) {
        organizations++;
        assert.deepEqual(data.allowedPeople, [
          "__unconfirmed__",
          "张三",
          "李四",
        ]);
        assert.deepEqual(data.allowedColumns, [
          "progress",
          "plans",
          "blockers",
        ]);
        const assignments = data.claims.map((c: Claim, index: number) => ({
          index,
          person: rejectWrongPerson ? "李四" : "speaker-2 (Guessed)",
          column: "progress",
        }));
        // An incomplete response must retry, never silently lose an approved claim.
        if (organizations === 1) assignments.pop();
        if (organizations === 2) assert.match(data.validationError, /遗漏/);
        value = { assignments };
      } else if (data.proposedClaims) {
        value = {
          reviews: data.proposedClaims.map((_: unknown, index: number) => ({
            index,
            supported: true,
            reason: "直接证据充分",
          })),
        };
      } else {
        generations++;
        value = {
          claims: data.segments.map((s: (typeof segments)[number]) => ({
            kind: "topic",
            text: s.text,
            owner: null,
            due: null,
            targetId: null,
            change: "new",
            evidence: [{ segmentId: s.id, quote: s.text }],
          })),
        };
      }
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(value) },
            },
          ],
        }),
      );
    } catch (e) {
      response.statusCode = 500;
      response.end(String(e));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const service = new Services(
    store,
    root,
    () => ({
      consent: true,
      asrUrl: "http://localhost",
      baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
      model: "fixture",
      contextBudget: 24000,
    }),
    () => "",
  );
  const wait = async () => {
    while (service.controllers.size) await new Promise((r) => setTimeout(r, 5));
  };
  try {
    const job = service.start(meeting.id, "analyze");
    await wait();
    const failed = store.get<Job>("jobs", job.id);
    assert.match(failed.error!, /该工作是张三本人完成/);
    assert.equal(store.get<Meeting>("meetings", meeting.id).analyses.length, 0);
    const checkpoint = [...failed.checkpoint!],
      originalGenerations = generations;
    service.retry(job.id);
    await wait();
    const done = store.get<Job>("jobs", job.id);
    assert.equal(done.status, "complete", done.error ?? "");
    assert.deepEqual(done.checkpoint, checkpoint);
    assert.equal(generations, originalGenerations);
    assert.ok(
      organizations >= 4,
      "multiple chapter batches should use local indices and merge",
    );
    assert.ok(chapterReviews >= 3, "every chapter batch must be reviewed");
    const analysis = store.get<Meeting>("meetings", meeting.id).analyses[0];
    assert.equal(analysis.claims.length, segments.length);
    assert.deepEqual(
      analysis.claims.map((c) => c.evidence[0].quote),
      segments.map((s) => s.text),
    );
    assert.deepEqual(analysis.sections, [
      {
        title: "未确认人员",
        claimIndices: [],
        children: [
          { title: "本周进展", claimIndices: [0, 1, 2, 3, 4], children: [] },
        ],
      },
    ]);
    assert.match(analysisMarkdown(analysis), /### 未确认人员/);
    assert.match(
      analysisMarkdown(analysis),
      new RegExp(`#s-${segments[4].id}`),
    );
    const audits = store.db
      .prepare(
        "SELECT value FROM meta WHERE key LIKE 'organization-group-audit:%'",
      )
      .all()
      .map((r) => JSON.parse(String(r.value)));
    assert.equal(JSON.parse(audits[0].verificationRaw).supported, false);
    assert.ok(
      audits
        .slice(1)
        .every(
          (a) =>
            a.personAdjustments.length &&
            JSON.parse(a.verificationRaw).supported,
        ),
    );
    assert.equal(
      JSON.parse(audits[1].generationRaw).assignments[0].person,
      "speaker-2 (Guessed)",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});
