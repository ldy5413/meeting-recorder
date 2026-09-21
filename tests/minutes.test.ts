import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/store";
import { Services } from "../electron/services";
import { organizeMinutes } from "../electron/minutes";
import {
  validateMinutes,
  currentMinutes,
  minutesPoints,
} from "../shared/minutes";
import { reportLabels } from "../shared/language";
import { markdown, subtitle } from "../electron/export";
import { backup, stageRestore } from "../electron/backup";
import type { Analysis, Job, Meeting, Settings } from "../shared/types";
import { languageFixture } from "./language-fixture";
import { minutesFixture } from "./minutes-fixture";
import { contextOf } from "../shared/analysis";

const language = {
  requested: "zh-CN" as const,
  locale: "zh-CN",
  labels: reportLabels["zh-CN"],
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "meeting-minutes-"));
  mkdirSync(join(root, "audio"));
  const store = new Store(join(root, "library.sqlite"));
  const m = store.createMeeting("Synthetic workshop", null);
  store.saveTranscript(
    m.id,
    0,
    [
      {
        id: randomUUID(),
        start: 0,
        end: 3,
        speaker: "speaker-1",
        text: "我下周验证接口。",
      },
    ],
    {},
  );
  const meeting = store.get<Meeting>("meetings", m.id);
  const analysis: Analysis = {
    id: randomUUID(),
    version: meeting.version,
    created: new Date().toISOString(),
    raw: "[]",
    editedNotes: null,
    language,
    snapshot: store.snapshot(meeting),
    claims: [
      {
        kind: "todo",
        text: "验证接口",
        owner: null,
        due: null,
        targetId: null,
        change: "new",
        evidence: [
          { segmentId: meeting.segments[0].id, quote: "我下周验证接口。" },
        ],
      },
    ],
  };
  meeting.analyses.push(analysis);
  store.put("meetings", meeting);
  const config: Settings = {
    model: "fixture",
    baseUrl: "http://localhost",
    asrUrl: "http://localhost",
    consent: true,
    contextBudget: 32000,
  };
  const service = new Services(
    store,
    join(root, "audio"),
    () => config,
    () => "",
  );
  return { root, store, meeting, analysis, service, config };
}
const point = {
  text: "讨论了接口验证，后续需要开展验证。",
  sourceIndices: [0],
};
const draft = () => ({
  overview: [point],
  sections: [{ title: "后续待办", items: [point], children: [] }],
});
async function idle(service: Services) {
  while (service.controllers.size) await new Promise((r) => setTimeout(r, 5));
}

test("synthesis validates references, decisions, action coverage and weekly person structure", () => {
  const { store, meeting, analysis } = fixture();
  try {
    assert.throws(
      () =>
        validateMinutes(
          { ...draft(), overview: [{ ...point, sourceIndices: [99] }] },
          1,
        ),
      /编号/,
    );
    assert.throws(
      () =>
        organizeMinutes(
          {
            ...draft(),
            sections: [{ title: "决策", items: [point], children: [] }],
          },
          analysis,
          meeting,
          "project-progress",
          language,
        ),
      /语音决策/,
    );
    const weekly = organizeMinutes(
      {
        overview: [point],
        entries: [{ ...point, person: "speaker-1", column: "plans" }],
      },
      analysis,
      meeting,
      "weekly",
      language,
    );
    assert.equal(weekly.sections[0].title, "speaker-1");
    assert.equal(weekly.sections[0].children[0].title, "下周计划");
    assert.throws(
      () =>
        organizeMinutes(
          {
            overview: [point],
            entries: [
              { ...point, person: "speaker-1 (Alice)", column: "plans" },
            ],
          },
          analysis,
          meeting,
          "weekly",
          language,
        ),
      /归属/,
    );
    analysis.claims.push({
      ...analysis.claims[0],
      kind: "summary",
      evidence: [
        { frameId: randomUUID(), quote: "Configuration file displayed" },
      ],
    });
    const visual = { text: "展示了配置文件", sourceIndices: [1] };
    assert.throws(
      () =>
        organizeMinutes(
          {
            overview: [point],
            sections: [{ title: "进展", items: [visual], children: [] }],
          },
          analysis,
          meeting,
          "project-progress",
          language,
        ),
      /遗漏/,
    );
    const result = organizeMinutes(
      {
        overview: [point],
        sections: [{ title: "进展", items: [visual, point], children: [] }],
      },
      analysis,
      meeting,
      "project-progress",
      language,
    );
    assert.match(result.sections[0].items[0].text, /^画面观察：/);
  } finally {
    store.close();
  }
});

test("failed synthesis retains detailed results, retry reuses draft and creates independent versions", async () => {
  const { store, meeting, analysis, service } = fixture();
  const before = JSON.stringify(analysis);
  let compose = 0,
    fail = true;
  service.chat = async (_system, data: any) => {
    if (data.minutesTask === "agenda") return minutesFixture(data)!;
    let value: any;
    if (data.minutesTask === "compose") {
      compose++;
      value = draft();
    } else if (data.minutesTask === "support") {
      if (fail) throw new Error("temporary service failure");
      value = {
        reviews: data.proposed.map((p: any) => ({
          index: p.index,
          supported: true,
          reason: "direct evidence",
        })),
      };
    } else if (data.minutesTask === "coverage") value = { missing: [] };
    else
      throw new Error(
        "Unexpected call; synthesis must not transcribe or recognize images",
      );
    return { value, raw: JSON.stringify(value) };
  };
  try {
    const job = service.start(meeting.id, "synthesize", false, analysis.id);
    await idle(service);
    assert.equal(store.get<Job>("jobs", job.id).status, "failed");
    assert.equal(
      JSON.stringify(store.get<Meeting>("meetings", meeting.id).analyses[0]),
      before,
    );
    store.configure("meetings", meeting.id, {
      ...contextOf(meeting.context),
      additionalRequirements: "New focus",
      reportLanguage: "en",
    });
    fail = false;
    service.retry(job.id);
    await idle(service);
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    assert.equal(compose, 1);
    const first = store.get<Meeting>("meetings", meeting.id).analyses[0]
      .minutes![0];
    assert.equal(first.additionalRequirements, "");
    assert.equal(first.language.locale, "zh-CN");
    service.start(meeting.id, "synthesize", false, analysis.id);
    await idle(service);
    const next = store.get<Meeting>("meetings", meeting.id);
    assert.equal(next.analyses.length, 1);
    assert.equal(next.analyses[0].minutes!.length, 2);
    assert.deepEqual(next.analyses[0].minutes![0], first);
    assert.equal(
      next.analyses[0].minutes![1].additionalRequirements,
      "New focus",
    );
    assert.equal(next.analyses[0].minutes![1].language.locale, "en");
    assert.equal(
      JSON.stringify({ ...next.analyses[0], minutes: undefined }),
      before,
    );
    assert.ok(currentMinutes(next));
    next.version++;
    store.put("meetings", next);
    assert.equal(currentMinutes(next), undefined);
    assert.throws(
      () => service.start(meeting.id, "synthesize", false, analysis.id),
      /过期/,
    );
  } finally {
    store.close();
  }
});

test("malformed coverage responses receive an explicit correction before minutes can be saved", async (t) => {
  for (const invalid of [{}, [], { missing: null }, { missing: [{}] }]) {
    await t.test(JSON.stringify(invalid), async () => {
      const { store, meeting, service } = fixture();
      let coverageCalls = 0;
      service.chat = async (_system, data: any) => {
        if (data.minutesTask !== "coverage") return minutesFixture(data)!;
        coverageCalls++;
        if (coverageCalls === 1)
          return { value: invalid, raw: JSON.stringify(invalid) };
        assert.equal(data.invalidOutput, JSON.stringify(invalid));
        assert.match(data.validationError, /全场内容覆盖检查返回格式错误/);
        assert.ok(data.validationError.includes('{"missing":[]}'));
        return { value: { missing: [] }, raw: '{"missing":[]}' };
      };
      try {
        const job = service.start(meeting.id, "synthesize");
        await idle(service);
        assert.equal(store.get<Job>("jobs", job.id).status, "complete");
        assert.equal(coverageCalls, 2);
        const minutes = store.get<Meeting>("meetings", meeting.id).analyses[0]
          .minutes![0];
        const audit = JSON.parse(
          store.db
            .prepare("SELECT value FROM meta WHERE key=?")
            .get(minutes.auditIds.at(-1)!)!.value as string,
        );
        assert.equal(audit.attempts[0].raw, JSON.stringify(invalid));
        assert.ok(audit.attempts[0].error);
        assert.equal(audit.attempts[1].error, null);
      } finally {
        store.close();
      }
    });
  }
});

test("repeated empty coverage objects fail safely and retry reuses completed minutes steps", async () => {
  const { store, meeting, service } = fixture();
  const before = JSON.stringify(meeting);
  const calls = { agenda: 0, compose: 0, support: 0, coverage: 0 };
  let fail = true;
  service.chat = async (_system, data: any) => {
    calls[data.minutesTask as keyof typeof calls]++;
    if (data.minutesTask === "coverage" && fail)
      return { value: {}, raw: "{}" };
    return minutesFixture(data)!;
  };
  try {
    const job = service.start(meeting.id, "synthesize");
    await idle(service);
    const failed = store.get<Job>("jobs", job.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.step, "检查全场内容覆盖 1/1");
    assert.match(failed.error!, /全场内容覆盖检查返回格式错误/);
    assert.ok(failed.error!.includes('{"missing":[]}'));
    assert.equal(JSON.stringify(store.get("meetings", meeting.id)), before);
    assert.deepEqual(calls, { agenda: 1, compose: 1, support: 1, coverage: 2 });
    fail = false;
    service.retry(job.id);
    await idle(service);
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    assert.deepEqual(calls, { agenda: 1, compose: 1, support: 1, coverage: 3 });
    assert.equal(
      store.get<Meeting>("meetings", meeting.id).analyses[0].minutes!.length,
      1,
    );
  } finally {
    store.close();
  }
});

test("semantic and whole-meeting coverage failures trigger regeneration and are not cached forever", async () => {
  const { store, meeting, service } = fixture();
  let compose = 0,
    reject = true;
  service.chat = async (_system, data: any) => {
    if (data.minutesTask === "agenda") return minutesFixture(data)!;
    let value;
    if (data.minutesTask === "compose") {
      compose++;
      value = draft();
    } else if (data.minutesTask === "support")
      value = {
        reviews: data.proposed.map((p: any) => ({
          index: p.index,
          supported: true,
          reason: "evidence",
        })),
      };
    else
      value = {
        missing: reject
          ? [{ sourceIndex: 0, reason: "important qualification omitted" }]
          : [],
      };
    return { value, raw: JSON.stringify(value) };
  };
  try {
    const job = service.start(meeting.id, "synthesize");
    await idle(service);
    assert.equal(compose, 3);
    assert.equal(store.get<Job>("jobs", job.id).status, "failed");
    assert.equal(
      store.get<Meeting>("meetings", meeting.id).analyses[0].minutes,
      undefined,
    );
    reject = false;
    service.retry(job.id);
    await idle(service);
    assert.equal(compose, 4);
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
  } finally {
    store.close();
  }
});

test("minutes export, source links and backup retain selected history without changing subtitles", async () => {
  const { root, store, meeting, analysis, service } = fixture();
  service.chat = async (_system, data: any) => {
    if (data.minutesTask === "agenda") return minutesFixture(data)!;
    const value =
      data.minutesTask === "compose"
        ? draft()
        : data.minutesTask === "support"
          ? {
              reviews: data.proposed.map((p: any) => ({
                index: p.index,
                supported: true,
                reason: "evidence",
              })),
            }
          : { missing: [] };
    return { value, raw: JSON.stringify(value) };
  };
  try {
    service.start(meeting.id, "synthesize");
    await idle(service);
    const m = store.get<Meeting>("meetings", meeting.id),
      s = m.analyses[0].minutes![0];
    const short = markdown(m, analysis.id, "frames", {
      minutesId: s.id,
      scope: "minutes",
    });
    assert.ok(short.includes(point.text));
    assert.ok(!short.includes('<a id="s-'));
    assert.ok(!short.includes("#claim-"));
    const full = markdown(m, analysis.id, "frames", {
      minutesId: s.id,
      scope: "full",
    });
    assert.match(full, /\(#claim-0\)/);
    assert.match(full, /id="claim-0"/);
    assert.equal(subtitle(m), subtitle(meeting));
    assert.throws(
      () => markdown(m, analysis.id, "frames", { minutesId: randomUUID() }),
      /版本不存在/,
    );
    const file = join(root, "backup.tar.gz");
    await backup(store, root, file);
    const staging = await stageRestore(file, root);
    const restored = new Store(join(staging, "library.sqlite"));
    assert.deepEqual(
      restored.get<Meeting>("meetings", m.id).analyses[0].minutes,
      m.analyses[0].minutes,
    );
    restored.close();
  } finally {
    store.close();
  }
});

test("desktop-style full analysis automatically starts an independent synthesis job", async () => {
  const { store, meeting, service } = fixture();
  service.chat = async (_system, data: any) => {
    if (data.minutesTask === "agenda") return minutesFixture(data)!;
    const languageResult = languageFixture(data);
    if (languageResult) return languageResult;
    const value =
      data.minutesTask === "compose"
        ? draft()
        : data.minutesTask === "support"
          ? {
              reviews: data.proposed.map((p: any) => ({
                index: p.index,
                supported: true,
                reason: "evidence",
              })),
            }
          : data.minutesTask === "coverage"
            ? { missing: [] }
            : data.sections
              ? { supported: true }
              : data.claims
                ? {
                    sections: [
                      { title: "后续待办", claimIndices: [0], children: [] },
                    ],
                  }
                : data.proposedClaims
                  ? {
                      reviews: [
                        { index: 0, supported: true, reason: "evidence" },
                      ],
                    }
                  : { claims: meeting.analyses[0].claims };
    return { value, raw: JSON.stringify(value) };
  };
  try {
    const job = service.start(meeting.id, "analyze", false, undefined, true);
    await idle(service);
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    const jobs = store.all<Job>("jobs");
    assert.equal(jobs.filter((j) => j.kind === "synthesize").length, 1);
    assert.equal(jobs.find((j) => j.kind === "synthesize")!.status, "complete");
    assert.ok(
      store.get<Meeting>("meetings", meeting.id).analyses.at(-1)!.minutes
        ?.length,
    );
  } finally {
    store.close();
  }
});

test("large meetings reduce bounded batches and coverage reviews visit the full original source", async () => {
  const { store, meeting, analysis, service, config } = fixture();
  config.contextBudget = 22000;
  analysis.claims = Array.from({ length: 36 }, (_, i) => ({
    ...analysis.claims[0],
    kind: "summary",
    text: `Topic ${i}: ${"Observed technical detail. ".repeat(60)}`,
  }));
  store.put("meetings", meeting);
  const seen: number[] = [];
  let outline = 0;
  service.chat = async (_system, data: any) => {
    if (data.minutesTask === "agenda") return minutesFixture(data)!;
    assert.ok(
      Buffer.byteLength(JSON.stringify(data)) < config.contextBudget - 4096,
    );
    let value;
    if (data.minutesTask === "outline") {
      outline++;
      value = {
        notes: [
          {
            text: "Combined synthetic technical topics",
            sourceIndices: data.allowedIndices,
          },
        ],
      };
    } else if (data.minutesTask === "compose") value = draft();
    else if (data.minutesTask === "support")
      value = {
        reviews: data.proposed.map((p: any) => ({
          index: p.index,
          supported: true,
          reason: "evidence",
        })),
      };
    else {
      seen.push(...data.facts.map((f: any) => f.index));
      value = { missing: [] };
    }
    return { value, raw: JSON.stringify(value) };
  };
  try {
    const job = service.start(meeting.id, "synthesize");
    await idle(service);
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    assert.ok(outline > 1);
    assert.deepEqual(
      seen,
      Array.from({ length: 36 }, (_, i) => i),
    );
    assert.equal(
      minutesPoints(
        store.get<Meeting>("meetings", meeting.id).analyses[0].minutes![0]
          .content,
      ).length,
      2,
    );
  } finally {
    store.close();
  }
});

test("cancelling synthesis never persists a late model response", async () => {
  const { store, meeting, analysis, service } = fixture();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let composing = false;
  service.chat = async (_system, data: any) => {
    if (data.minutesTask === "agenda") return minutesFixture(data)!;
    composing = true;
    await gate;
    return { value: draft(), raw: JSON.stringify(draft()) };
  };
  try {
    const job = service.start(meeting.id, "synthesize");
    while (!composing) await new Promise((r) => setTimeout(r, 5));
    await service.cancel(job.id);
    release();
    await idle(service);
    assert.equal(store.get<Job>("jobs", job.id).status, "cancelled");
    assert.deepEqual(
      store.get<Meeting>("meetings", meeting.id).analyses[0],
      analysis,
    );
  } finally {
    release();
    store.close();
  }
});
