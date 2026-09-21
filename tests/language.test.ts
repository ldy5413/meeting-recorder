import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../electron/store";
import { Services } from "../electron/services";
import { markdown, subtitle } from "../electron/export";
import { backup, stageRestore } from "../electron/backup";
import { buildWeeklySections, weeklyPeople } from "../electron/weekly-sections";
import {
  SettingsSchema,
  type Meeting,
  type Settings,
  type Job,
} from "../shared/types";
import {
  reportLabels,
  resolveUiLocale,
  languageSamples,
  normalizeDetectedLocale,
  type ReportLanguage,
} from "../shared/language";
import { messages } from "../shared/messages-data";
import { isAnonymousSpeakerLabel } from "../shared/speakers";
import {
  translate,
  translateMessage,
  describeMessage,
} from "../shared/messages";

function fixture(language: ReportLanguage = "auto") {
  const root = mkdtempSync(join(tmpdir(), "meeting-language-"));
  const settings: Settings = {
    asrUrl: "http://localhost",
    baseUrl: "http://localhost",
    model: "fixture",
    consent: true,
    contextBudget: 12000,
    defaultReportLanguage: language,
  };
  const store = new Store(join(root, "library.sqlite"), () => settings);
  const meeting = store.createMeeting("Source title remains unchanged", null);
  const saved = store.saveTranscript(
    meeting.id,
    0,
    [
      {
        id: randomUUID(),
        start: 0,
        end: 30,
        speaker: "speaker-1",
        text: "我们决定采用 SQLite 保存会议。",
      },
    ],
    {},
  );
  const service = new Services(
    store,
    join(root, "audio"),
    () => settings,
    () => "",
  );
  return { root, settings, store, meeting: saved, service };
}
async function finished(service: Services) {
  const end = Date.now() + 5000;
  while (service.controllers.size) {
    if (Date.now() > end) throw new Error("Fixture task timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("system locale, dictionaries and interpolated legacy messages are independent of data", () => {
  assert.equal(resolveUiLocale("system", "zh-TW"), "zh-CN");
  assert.equal(resolveUiLocale("system", "fr-FR"), "en");
  assert.equal(resolveUiLocale("en", "zh-CN"), "en");
  assert.equal(resolveUiLocale("zh-CN", "en-US"), "zh-CN");
  assert.equal(
    normalizeDetectedLocale("en-US"),
    normalizeDetectedLocale("en-GB"),
  );
  assert.equal(normalizeDetectedLocale("zh-Hant"), "zh-TW");
  assert.equal(normalizeDetectedLocale("zh"), "zh-CN");
  assert.equal(normalizeDetectedLocale("mul"), null);
  assert.ok(isAnonymousSpeakerLabel("Unconfirmed speaker 1"));
  assert.ok(isAnonymousSpeakerLabel("Silence / Non-speech"));
  assert.equal(isAnonymousSpeakerLabel("Alex"), false);
  for (const [key, english] of Object.entries(messages)) {
    assert.ok(english.trim(), key);
    assert.deepEqual(
      key.match(/\{p\d+\}/g)?.sort() ?? [],
      english.match(/\{p\d+\}/g)?.sort() ?? [],
      key,
    );
  }
  assert.equal(
    translate("en", "分析 {p0}/{p1}", { p0: 1, p1: 4 }),
    "Analyzing 1/4",
  );
  assert.equal(
    translateMessage("en", "分析与核对 2/4 组"),
    "Analyzing and verifying 2/4 groups",
  );
  assert.equal(describeMessage("分析与核对 2/4 组")?.params?.p0, "2");
  assert.equal(translateMessage("zh-CN", "Analyzing 1/4"), "分析 1/4");
  assert.equal(
    translateMessage("en", "提取声纹 1/3（0/2）"),
    "Extracting speaker embeddings 1/3 (0/2)",
  );
  assert.equal(
    translateMessage("zh-CN", "chunk 1/3 (0s + 30s)"),
    "转录分段 1/3（0秒 + 30秒）",
  );
  assert.equal(
    translateMessage("en", "Provider error 503: verbatim detail"),
    "Provider error 503: verbatim detail",
  );
});

test("defaults are copied, upper-level edits do not change meetings, and reload is explicit", () => {
  const f = fixture("en");
  try {
    const project = f.store.createProject("project");
    const first = f.store.createMeeting("first", project.id);
    assert.equal(first.context?.reportLanguage, "en");
    f.settings.defaultReportLanguage = "zh-CN";
    assert.equal(
      f.store.createMeeting("unassigned", null).context?.reportLanguage,
      "zh-CN",
    );
    assert.equal(
      f.store.createMeeting("assigned", project.id).context?.reportLanguage,
      "en",
    );
    f.store.configure("projects", project.id, {
      ...project.context,
      reportLanguage: "auto",
    });
    assert.equal(
      f.store.get<Meeting>("meetings", first.id).context?.reportLanguage,
      "en",
    );
    assert.equal(
      f.store.reloadDefaults(first.id).context?.reportLanguage,
      "auto",
    );
    assert.equal(
      SettingsSchema.parse({ ...f.settings, uiLanguage: "system" }).uiLanguage,
      "system",
    );
    assert.throws(() =>
      SettingsSchema.parse({ ...f.settings, defaultReportLanguage: "invalid" }),
    );
  } finally {
    f.store.close();
  }
});

test("automatic language uses distributed speech samples, caches by transcript version, and handles third languages", async () => {
  const f = fixture();
  let calls = 0;
  try {
    const segments = Array.from({ length: 100 }, (_, i) => ({
      ...f.meeting.segments[0],
      id: randomUUID(),
      start: i * 10,
      end: i * 10 + 8,
      text: `Sample ${i}: We reviewed progress and decided to ship next week. `.repeat(
        7,
      ),
    }));
    assert.equal(languageSamples(segments)[0].text, segments[0].text);
    assert.equal(languageSamples(segments).at(-1)?.text, segments.at(-1)?.text);
    f.service.chat = async (_system, data: any) => {
      calls++;
      assert.equal(data.languageTask, "detect-report");
      assert.equal(data.context, undefined);
      const value = {
        languages: data.samples.map((_: unknown, index: number) => ({
          index,
          locale: "en",
        })),
      };
      return { raw: JSON.stringify(value), value };
    };
    const long = {
      ...f.meeting,
      segments,
      context: {
        ...f.meeting.context!,
        background: "只用中文回答",
        additionalRequirements: "中文",
      },
    };
    assert.equal(
      (await f.service.resolveReportLanguage(long, "auto")).locale,
      "en",
    );
    const afterFirst = calls;
    assert.ok(afterFirst > 1, "bounded requests for long samples");
    assert.equal(
      (await f.service.resolveReportLanguage(long, "auto")).locale,
      "en",
    );
    assert.equal(calls, afterFirst);
    await f.service.resolveReportLanguage(
      { ...long, version: long.version + 1 },
      "auto",
    );
    assert.ok(calls > afterFirst);
    f.service.chat = async (_system, data: any) => {
      const value =
        data.languageTask === "detect-report"
          ? {
              languages: data.samples.map((_: unknown, index: number) => ({
                index,
                locale: "ja",
              })),
            }
          : { ...reportLabels.en, notes: "議事録", progress: "今週の進捗" };
      return { raw: JSON.stringify(value), value };
    };
    const japanese = await f.service.resolveReportLanguage(
      { ...long, version: 99 },
      "auto",
    );
    assert.equal(japanese.locale, "ja");
    assert.equal(japanese.labels.notes, "議事録");
  } finally {
    f.store.close();
  }
});

test("evenly mixed or silent audio requires a choice; explicit language bypasses detection", async () => {
  const f = fixture();
  try {
    f.service.chat = async (_system, data: any) => {
      const value = {
        languages: data.samples.map((_: unknown, index: number) => ({
          index,
          locale: index % 2 ? "en" : "zh-CN",
        })),
      };
      return { raw: JSON.stringify(value), value };
    };
    const mixed = {
      ...f.meeting,
      segments: [
        f.meeting.segments[0],
        { ...f.meeting.segments[0], id: randomUUID() },
      ],
    };
    await assert.rejects(
      f.service.resolveReportLanguage(mixed, "auto"),
      /指定报告语言/,
    );
    await assert.rejects(
      f.service.resolveReportLanguage({ ...mixed, segments: [] }, "auto"),
      /指定报告语言/,
    );
    f.service.chat = async () => {
      throw new Error("Explicit language must not call detection");
    };
    assert.equal(
      (await f.service.resolveReportLanguage(mixed, "en")).locale,
      "en",
    );
  } finally {
    f.store.close();
  }
});

test("language detection fits the minimum context budget even for long Chinese segments", async () => {
  const f = fixture();
  f.settings.contextBudget = 4096;
  try {
    f.service.chat = async (system, data: any) => {
      assert.ok(
        Buffer.byteLength(system + JSON.stringify(data)) + 512 <
          f.settings.contextBudget,
      );
      const value = {
        languages: data.samples.map((_: unknown, index: number) => ({
          index,
          locale: "zh-CN",
        })),
      };
      return { raw: JSON.stringify(value), value };
    };
    const language = await f.service.resolveReportLanguage(
      {
        ...f.meeting,
        segments: f.meeting.segments.map((s) => ({
          ...s,
          text: s.text.repeat(1000),
        })),
      },
      "auto",
    );
    assert.equal(language.locale, "zh-CN");
  } finally {
    f.store.close();
  }
});

test("grounded answers follow the resolved question language and keep source quotes", async () => {
  const f = fixture("zh-CN");
  const prompts: string[] = [];
  try {
    f.service.chat = async (system, data: any) => {
      if (data.languageTask === "answer-language") {
        const value = { locale: "en", noEvidence: "Insufficient evidence." };
        return { raw: JSON.stringify(value), value };
      }
      prompts.push(system);
      const source = data.segments[0];
      const value = {
        text: `The team decided to use SQLite. [${source.id}]`,
        evidence: [{ segmentId: source.id, quote: source.text }],
      };
      return { raw: JSON.stringify(value), value };
    };
    const answer = await f.service.ask("SQLite", null, f.meeting.id, "", "");
    assert.ok(prompts.length > 0);
    assert.ok(
      prompts.every((prompt) => prompt.includes("OUTPUT LANGUAGE: en")),
    );
    assert.match(answer.text, /The team decided/);
    assert.equal(answer.evidence[0].quote, f.meeting.segments[0].text);
  } finally {
    f.store.close();
  }
});

test("analysis freezes language across retries and keeps cross-language quotes, exports and history", async () => {
  const f = fixture("en");
  let failOrganization = true;
  const prompts: string[] = [];
  f.service.chat = async (system, data: any) => {
    let value;
    if (data.proposedClaims)
      value = {
        reviews: data.proposedClaims.map((_: unknown, index: number) => ({
          index,
          supported: true,
          reason: "Direct source evidence",
        })),
      };
    else if (data.sections) value = { supported: true };
    else if (data.claims) {
      prompts.push(system);
      if (failOrganization)
        throw new Error("Synthetic organization interruption");
      value = {
        sections: [
          {
            title: system.includes("OUTPUT LANGUAGE: en")
              ? "Decisions"
              : "决策",
            claimIndices: [0],
            children: [],
          },
        ],
      };
    } else {
      prompts.push(system);
      value = {
        claims: [
          {
            kind: "decision",
            text: system.includes("OUTPUT LANGUAGE: en")
              ? "Use SQLite to store meetings."
              : "采用 SQLite 保存会议。",
            owner: null,
            due: null,
            targetId: null,
            change: "new",
            evidence: [
              {
                segmentId: f.meeting.segments[0].id,
                quote: f.meeting.segments[0].text,
              },
            ],
          },
        ],
      };
    }
    return { raw: JSON.stringify(value), value };
  };
  try {
    const job = f.service.start(f.meeting.id, "analyze");
    await finished(f.service);
    const failed = f.store.get<Job>("jobs", job.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.language?.locale, "en");
    const checkpoint = failed.checkpoint![0];
    f.store.configure("meetings", f.meeting.id, {
      ...f.meeting.context!,
      reportLanguage: "zh-CN",
    });
    failOrganization = false;
    f.service.retry(job.id);
    await finished(f.service);
    assert.equal(
      f.store.get<Job>("jobs", job.id).status,
      "complete",
      f.store.get<Job>("jobs", job.id).error ?? "",
    );
    assert.equal(f.store.get<Job>("jobs", job.id).checkpoint![0], checkpoint);
    const first = f.store.get<Meeting>("meetings", f.meeting.id).analyses[0];
    assert.equal(first.language?.locale, "en");
    assert.ok(
      prompts.every((prompt) => prompt.includes("OUTPUT LANGUAGE: en")),
    );
    assert.equal(first.claims[0].evidence[0].quote, f.meeting.segments[0].text);
    f.service.start(f.meeting.id, "analyze");
    await finished(f.service);
    const meeting = f.store.get<Meeting>("meetings", f.meeting.id);
    assert.equal(meeting.analyses.length, 2);
    assert.equal(meeting.analyses[1].language?.locale, "zh-CN");
    const english = markdown(meeting, first.id);
    assert.match(english, /## Meeting notes/);
    assert.match(english, /## Transcript/);
    assert.match(english, /\*\*Decision\*\* Use SQLite/);
    assert.ok(english.includes(f.meeting.segments[0].text));
    assert.equal(subtitle(meeting), subtitle(f.meeting));
    assert.equal(f.store.all("records").length, 0);
    mkdirSync(join(f.root, "audio"));
    const archive = join(f.root, "backup.tar.gz");
    await backup(f.store, f.root, archive);
    const staging = await stageRestore(archive, f.root);
    const restored = new Store(join(staging, "library.sqlite"));
    try {
      assert.equal(
        markdown(restored.get<Meeting>("meetings", meeting.id), first.id),
        english,
      );
    } finally {
      restored.close();
    }
  } finally {
    f.store.close();
  }
});

test("weekly identifiers produce localized headings without changing confirmed names or indices", () => {
  const people = weeklyPeople([], { "speaker-1": "张三" });
  const { sections } = buildWeeklySections(
    {
      assignments: [
        { index: 0, person: null, column: "progress" },
        { index: 1, person: "张三", column: "plans" },
      ],
    },
    2,
    people,
    [],
    reportLabels.en,
  );
  assert.equal(sections[0].title, "Unconfirmed person");
  assert.equal(sections[0].children[0].title, "This week's progress");
  assert.deepEqual(sections[1], {
    title: "张三",
    claimIndices: [],
    children: [{ title: "Next week's plans", claimIndices: [1], children: [] }],
  });
});

test("question language resolution applies to no-evidence answers independently of UI and report defaults", async () => {
  const f = fixture("zh-CN");
  try {
    f.settings.uiLanguage = "zh-CN";
    f.service.chat = async (_system, data: any) => {
      assert.equal(data.languageTask, "answer-language");
      assert.equal(data.question, "Please answer in English: UnmatchedQuery");
      const value = {
        locale: "en",
        noEvidence: "The transcripts do not provide enough evidence.",
      };
      return { raw: JSON.stringify(value), value };
    };
    const answer = await f.service.ask(
      "Please answer in English: UnmatchedQuery",
      null,
      null,
      "",
      "",
    );
    assert.equal(
      answer.text,
      "The transcripts do not provide enough evidence.",
    );
    assert.deepEqual(answer.evidence, []);
  } finally {
    f.store.close();
  }
});
