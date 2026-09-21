import { languageFixture } from "./language-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  bindVisualEvidence,
  visualEvidenceSources,
  restoreVisualQuotes,
} from "../electron/visual-evidence";
import { Store, checkEvidence } from "../electron/store";
import { Services } from "../electron/services";
import { withParameterDetails, parameterText } from "../shared/visual";
import type { Claim, Job, Meeting, VisualFrame } from "../shared/types";

const makeFrame = (text: string, start = 0): VisualFrame => ({
  id: randomUUID(),
  file: `${randomUUID()}.jpg`,
  start,
  end: start + 5,
  title: "Synthetic fixture",
  text,
  uncertain: "",
  excluded: false,
  contentType: "content",
  parameters: [],
  model: "fixture",
});
const makeClaim = (frameId: string, quote: string): Claim => ({
  kind: "summary",
  text: "Synthetic visual fact",
  owner: null,
  due: null,
  targetId: null,
  change: "new",
  evidence: [{ frameId, quote }],
});

test("visual quotes with omitted or added bold markers bind to exact source text without changing observations", () => {
  const frame = makeFrame(
    "- **试验包**：在干态条件下，60/80/100°C 三个温度水平。\n**响应**为剥离强度。",
  );
  const original = makeClaim(
    frame.id,
    "试验包：在干态条件下，60/80/100°C 三个温度水平。",
  );
  const baseline = JSON.stringify({ frame, original });
  assert.throws(
    () => checkEvidence(original.evidence, [], [frame]),
    /引文与原文不一致/,
  );
  const result = restoreVisualQuotes([original], [frame]);
  assert.equal(
    result.claims[0].evidence[0].quote,
    "**试验包**：在干态条件下，60/80/100°C 三个温度水平。",
  );
  checkEvidence(result.claims[0].evidence, [], [frame]);
  assert.equal(result.quoteRepairs.length, 1);
  assert.equal(
    result.quoteRepairs[0].originalQuote,
    original.evidence[0].quote,
  );
  assert.equal(JSON.stringify({ frame, original }), baseline);
  const added = restoreVisualQuotes(
    [makeClaim(frame.id, "为**剥离强度**。")],
    [frame],
  );
  assert.equal(added.claims[0].evidence[0].quote, "为剥离强度。");
  const exact = makeClaim(frame.id, "**响应**为剥离强度。");
  assert.deepEqual(restoreVisualQuotes([exact], [frame]), {
    claims: [exact],
    quoteRepairs: [],
  });
});

test("quote restoration refuses changed facts, joined sources, wrong IDs, ambiguous matches and arithmetic", () => {
  const frame = makeFrame("**压力**：80 kPa；不代表已完成。\n**温度**：60°C。");
  for (const quote of [
    "压力：90 kPa；不代表已完成。",
    "压力：80 MPa；不代表已完成。",
    "压力：80 kPa；代表已完成。",
    "压力：80kPa；不代表已完成。",
    "压力：80 kPa，不代表已完成。",
    "压力：80 kPa；不代表已完成。温度：60°C。",
  ]) {
    const claim = makeClaim(frame.id, quote);
    assert.deepEqual(restoreVisualQuotes([claim], [frame]), {
      claims: [claim],
      quoteRepairs: [],
    });
    assert.throws(() => checkEvidence(claim.evidence, [], [frame]));
  }
  for (const [text, quote] of [
    ["2**3**4", "234"],
    ["`**压力**：80 kPa`", "压力：80 kPa"],
    ["```\n**压力**：80 kPa\n```", "压力：80 kPa"],
    ["**压力**：80 kPa；**压力**：80 kPa", "压力：80 kPa"],
  ]) {
    const source = makeFrame(text),
      claim = makeClaim(source.id, quote);
    assert.equal(restoreVisualQuotes([claim], [source]).quoteRepairs.length, 0);
    assert.throws(() => checkEvidence(claim.evidence, [], [source]));
  }
  const foreign = makeClaim(randomUUID(), "压力：80 kPa");
  const speech: Claim = {
    ...foreign,
    evidence: [{ segmentId: frame.id, quote: "压力：80 kPa" }],
  };
  for (const claim of [foreign, speech]) {
    assert.equal(restoreVisualQuotes([claim], [frame]).quoteRepairs.length, 0);
    assert.throws(() => checkEvidence(claim.evidence, [], [frame]));
  }
});

test("source IDs preserve inline code, line breaks, long text and full parameter conditions without model-written quotes", () => {
  const frame = makeFrame(
    "- `X_L`：常规含量；\n- `X_H`：建议 `X_H ≈ 2–4 × X_L`。\n```text\nX = C_0\n```\n" +
      "长段落😀".repeat(400),
  );
  frame.parameters = [
    {
      object: "测试液",
      metric: "X_H",
      value: "2–4 × X_L",
      unit: "",
      conditions: ["同一批次", "条件".repeat(1200)],
    },
  ];
  const sources = visualEvidenceSources(frame);
  assert.deepEqual(visualEvidenceSources(frame), sources);
  assert.equal(new Set(sources.map((s) => s.id)).size, sources.length);
  for (const s of sources) {
    assert.ok(s.quote.length > 0 && s.quote.length <= 1200);
    assert.ok(
      (s.parameterIndex === undefined
        ? frame.text
        : parameterText(frame.parameters[s.parameterIndex])
      ).includes(s.quote),
    );
    assert.ok(!/[\uD800-\uDBFF]$/.test(s.quote));
  }
  const chosen = [
    sources.find((s) => s.quote.includes("`X_L`"))!,
    sources.find((s) => s.parameterIndex === 0)!,
  ];
  const input = {
    claims: [
      {
        ...makeClaim(frame.id, ""),
        evidence: chosen.map((s) => ({ frameId: frame.id, sourceId: s.id })),
      },
    ],
  };
  const baseline = JSON.stringify({ input, frame });
  const bound = bindVisualEvidence(input, [frame]);
  assert.deepEqual(
    bound.claims[0].evidence.map((e) => e.quote),
    chosen.map((s) => s.quote),
  );
  assert.deepEqual(bound.claims[0].parameterRefs, [
    { frameId: frame.id, index: 0 },
  ]);
  const complete = withParameterDetails(bound.claims[0], [frame]);
  assert.ok(complete.text.includes(parameterText(frame.parameters[0])));
  checkEvidence(complete.evidence, [], [frame]);
  assert.equal(bound.quoteBindings.length, 2);
  assert.equal(JSON.stringify({ input, frame }), baseline);
});

test("source binding rejects missing IDs, foreign frames, speech impersonation and conflicting model quotes", () => {
  const frame = makeFrame("`X_H` 不代表已完成。");
  const sourceId = visualEvidenceSources(frame)[0].id;
  for (const evidence of [
    { frameId: frame.id, sourceId: "text:999" },
    { frameId: randomUUID(), sourceId },
    { segmentId: frame.id, sourceId },
    { frameId: frame.id, sourceId, quote: "X_H 代表已完成。" },
  ])
    assert.throws(() =>
      bindVisualEvidence(
        { claims: [{ ...makeClaim(frame.id, ""), evidence: [evidence] }] },
        [frame],
      ),
    );
  const legacy = makeClaim(frame.id, "X_H 代表已完成。");
  const result = bindVisualEvidence({ claims: [legacy] }, [frame]);
  assert.throws(() => checkEvidence(result.claims[0].evidence, [], [frame]));
});

test("retry preserves visual groups, binds source IDs, audits legacy repairs and still requires original-image semantic review", async () => {
  const root = mkdtempSync(join(tmpdir(), "visual-quote-retry-"));
  const audio = join(root, "audio");
  mkdirSync(audio);
  mkdirSync(join(root, "frames"));
  const store = new Store(join(root, "library.sqlite"));
  const meeting = store.createMeeting("Visual quote fixture", null);
  const frames = [
    makeFrame("**压力**：80 kPa。"),
    makeFrame("**温度**：60°C。", 10),
  ];
  frames.forEach((f) =>
    writeFileSync(join(root, "frames", f.file), "synthetic image bytes"),
  );
  meeting.audio = `${meeting.id}.webm`;
  meeting.context!.reportLanguage = "en"; // Silent video requires an explicit language.
  meeting.mediaType = "video";
  meeting.status = "ready";
  meeting.video = {
    duration: 15,
    width: 100,
    height: 100,
    hasAudio: false,
    revision: 1,
    extracted: true,
    frames,
  };
  store.put("meetings", meeting);
  const service = new Services(
    store,
    audio,
    () => ({
      asrUrl: "http://localhost",
      baseUrl: "http://localhost",
      model: "fixture",
      contextBudget: 65536,
      consent: true,
      visualConsent: true,
    }),
    () => "",
  );
  let fail = true,
    firstCalls = 0,
    secondReviews = 0;
  service.chat = async (_system, data: any, _signal, images = []) => {
    const language = languageFixture(data);
    if (language) return language;
    let value: unknown;
    if (data.proposedClaims) {
      assert.equal(images.length, 1);
      for (const c of data.proposedClaims)
        checkEvidence(c.evidence, [], frames);
      if (data.frames[0].id === frames[1].id) secondReviews++;
      value = {
        reviews: data.proposedClaims.map((c: Claim, index: number) => ({
          index,
          supported: c.text !== "Unsupported inference",
          novel: true,
          reason: "Fixture review",
        })),
      };
    } else if (data.sections) value = { supported: true };
    else if (data.claims)
      value = {
        sections: [
          {
            title: "Observed facts",
            claimIndices: data.allowedIndices,
            children: [],
          },
        ],
      };
    else {
      const first = data.frames[0].id === frames[0].id;
      if (first) firstCalls++;
      const claim = makeClaim(
        data.frames[0].id,
        first ? frames[0].text : fail ? "温度：90°C。" : "温度：60°C。",
      );
      claim.text = first ? "Pressure observation" : "Temperature observation";
      if (data.validationError) {
        assert.ok(data.correction.includes("sourceId"));
        assert.ok(
          data.invalidReferences[0].actualSegmentText.includes("**温度**"),
        );
      }
      assert.ok(
        data.frames[0].evidenceSources.some(
          (s: { id: string }) => s.id === "text:0",
        ),
      );
      value = {
        claims: [
          !first && !fail
            ? {
                ...claim,
                evidence: [{ frameId: frames[1].id, sourceId: "text:0" }],
              }
            : claim,
          ...(!first && !fail
            ? [{ ...claim, text: "Unsupported inference" }]
            : []),
        ],
      };
    }
    return { raw: JSON.stringify(value), value };
  };
  const wait = async () => {
    while (service.controllers.size) await new Promise((r) => setTimeout(r, 5));
  };
  try {
    const job = service.start(meeting.id, "analyze", true);
    await wait();
    const failed = store.get<Job>("jobs", job.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.checkpoint!.length, 1);
    assert.equal(secondReviews, 0);
    const completed = failed.checkpoint![0];
    fail = false;
    service.retry(job.id);
    await wait();
    const done = store.get<Job>("jobs", job.id);
    assert.equal(done.status, "complete", done.error ?? "");
    assert.equal(done.checkpoint![0], completed);
    assert.equal(firstCalls, 1);
    assert.equal(secondReviews, 1);
    const checkpoint = JSON.parse(done.checkpoint![1]);
    assert.equal(checkpoint.quoteRepairs.length, 1);
    assert.equal(checkpoint.quoteBindings.length, 1);
    assert.equal(
      JSON.parse(checkpoint.generationRaw).claims[0].evidence[0].sourceId,
      "text:0",
    );
    assert.equal(checkpoint.claims[0].evidence[0].quote, frames[1].text);
    const result = store.get<Meeting>("meetings", meeting.id).analyses[0];
    assert.deepEqual(
      result.claims.map((c) => c.text),
      ["Pressure observation", "Temperature observation"],
    );
    const audit = store.db
      .prepare(
        "SELECT value FROM meta WHERE key LIKE 'analysis-audit:%' ORDER BY rowid DESC LIMIT 1",
      )
      .get()!;
    assert.equal(JSON.parse(String(audit.value)).quoteRepairs.length, 1);
    assert.equal(JSON.parse(String(audit.value)).quoteBindings.length, 1);
  } finally {
    store.close();
  }
});
