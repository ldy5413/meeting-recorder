import { languageFixture } from "./language-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, validateClaims } from "../electron/store";
import { Services } from "../electron/services";
import {
  withParameterDetails,
  parameterText,
  relatedClaims,
} from "../shared/visual";
import { markdown } from "../electron/export";
import {
  ClaimSchema,
  type Claim,
  type Job,
  type Meeting,
  type VisualFrame,
} from "../shared/types";

test("table facts remain available for novelty comparison despite repeated evidence; complete 13-parameter rows keep every reference", () => {
  const frame: VisualFrame = {
    id: randomUUID(),
    file: `${randomUUID()}.jpg`,
    start: 0,
    end: 10,
    title: "Test table",
    text: "Cell specifications",
    uncertain: "",
    excluded: false,
    parameters: Array.from({ length: 13 }, (_, i) => ({
      object: "Sample",
      metric: `Metric ${i}`,
      value: String(i),
      unit: "V",
      conditions: ["at 25 C", "to 80% capacity"],
    })),
  };
  const table = ClaimSchema.parse(
    withParameterDetails(
      {
        kind: "summary",
        text: "Cell specifications",
        owner: null,
        due: null,
        targetId: null,
        change: "new",
        evidence: [{ frameId: frame.id, quote: frame.text }],
        parameterRefs: frame.parameters!.map((_, index) => ({
          frameId: frame.id,
          index,
        })),
      },
      [frame],
    ),
  );
  assert.equal(table.parameterRefs?.length, 13);
  assert.ok(table.text.includes(parameterText(frame.parameters![12])));
  assert.throws(
    () =>
      withParameterDetails(
        { ...table, parameterRefs: [{ frameId: frame.id, index: 13 }] },
        [frame],
      ),
    /索引 13 不存在.*合法索引为 0-12/,
  );
  const later: Claim = {
    ...table,
    text: "A different visual fact",
    parameterRefs: [],
  };
  const budget = JSON.stringify(table).length - 100;
  const related = relatedClaims([table, later], [], budget, [frame]);
  assert.equal(related[0].text, table.text);
  assert.ok(related[0].text.includes("to 80% capacity"));
  assert.ok(JSON.stringify(related).length <= budget + 10);
  assert.ok(!("evidence" in related[0]));
});

test("identical images reuse observations while explicit re-recognition bypasses cache and preserves historical parameter citations", async () => {
  const root = mkdtempSync(join(tmpdir(), "visual-cache-")),
    audio = join(root, "audio");
  mkdirSync(audio);
  mkdirSync(join(root, "frames"));
  const store = new Store(join(root, "library.sqlite"));
  const m = store.createMeeting("Cache", null);
  m.audio = `${m.id}.webm`;
  const frames: VisualFrame[] = [0, 5].map((start) => ({
    id: randomUUID(),
    file: `${randomUUID()}.jpg`,
    start,
    end: start + 5,
    title: "",
    text: "",
    uncertain: "",
    excluded: false,
  }));
  frames.forEach((f) =>
    writeFileSync(join(root, "frames", f.file), "identical image bytes"),
  );
  m.video = {
    duration: 10,
    width: 320,
    height: 180,
    hasAudio: false,
    revision: 0,
    extracted: true,
    frames,
  };
  store.put("meetings", m);
  let requests = 0;
  const service = new Services(
    store,
    audio,
    () => ({
      asrUrl: "http://localhost",
      baseUrl: "http://localhost",
      model: "test",
      contextBudget: 65536,
      consent: true,
      visualConsent: true,
    }),
    () => "",
  );
  service.chat = async () => {
    requests++;
    const value = {
      contentType: "content",
      title: "Parameter",
      text: "Observed parameter",
      uncertain: "",
      parameters: [
        {
          object: "Sample",
          metric: "Cycle Life",
          value: String(requests * 1000),
          unit: "cycles",
          conditions: ["to 80% capacity"],
        },
      ],
    };
    return { raw: JSON.stringify(value), value };
  };
  const wait = async () => {
    while (service.controllers.size) await new Promise((r) => setTimeout(r, 5));
  };
  try {
    const first = service.start(m.id, "visuals");
    await wait();
    assert.equal(store.get<Job>("jobs", first.id).status, "complete");
    assert.equal(requests, 1);
    const observed = store.get<Meeting>("meetings", m.id),
      oldFrame = structuredClone(observed.video!.frames[0]);
    const claim = withParameterDetails(
      {
        kind: "summary",
        text: "Observed life",
        owner: null,
        due: null,
        change: "new",
        targetId: null,
        evidence: [{ frameId: oldFrame.id, quote: oldFrame.text }],
        parameterRefs: [{ frameId: oldFrame.id, index: 0 }],
      },
      [oldFrame],
    );
    observed.analyses.push({
      id: randomUUID(),
      created: new Date().toISOString(),
      version: 0,
      raw: "{}",
      claims: [claim],
      editedNotes: null,
      visual: { revision: observed.video!.revision, frames: [oldFrame] },
    });
    observed.video!.frames[0].needsRecognition = true;
    observed.video!.revision++;
    store.put("meetings", observed);
    const second = service.start(m.id, "visuals");
    await wait();
    assert.equal(store.get<Job>("jobs", second.id).status, "complete");
    assert.equal(requests, 2);
    const current = store.get<Meeting>("meetings", m.id);
    assert.equal(current.video!.frames[0].parameters![0].value, "2000");
    assert.equal(current.video!.frames[1].parameters![0].value, "1000");
    assert.equal(
      store.resolveEvidence(claim.evidence.at(-1)!).frame?.parameters?.[0]
        .value,
      "1000",
    );
  } finally {
    store.close();
  }
});

test("parameter conditions survive summarization, export and historical snapshots; foreign references fail", () => {
  const frame: VisualFrame = {
    id: randomUUID(),
    file: `${randomUUID()}.jpg`,
    start: 0,
    end: 10,
    title: "Cell",
    text: "Gen4 Cycle Life >1000 cycles to 80% capacity",
    uncertain: "",
    excluded: false,
    parameters: [
      {
        object: "Gen4",
        metric: "Cycle Life",
        value: ">1000",
        unit: "cycles",
        conditions: ["to 80% capacity"],
      },
    ],
  };
  const proposed: Claim = {
    kind: "summary",
    text: "Gen4寿命超过1000次",
    owner: null,
    due: null,
    targetId: null,
    change: "new",
    evidence: [{ frameId: frame.id, quote: frame.text }],
    parameterRefs: [{ frameId: frame.id, index: 0 }],
  };
  const claim = withParameterDetails(proposed, [frame]);
  assert.match(claim.text, /to 80% capacity/);
  assert.deepEqual(withParameterDetails(claim, [frame]), claim);
  validateClaims([claim], [], [], {}, [frame]);
  assert.throws(() =>
    withParameterDetails(
      { ...proposed, parameterRefs: [{ frameId: frame.id, index: 1 }] },
      [frame],
    ),
  );
  assert.throws(() =>
    validateClaims(
      [{ ...claim, evidence: [{ frameId: randomUUID(), quote: frame.text }] }],
      [],
      [],
      {},
      [frame],
    ),
  );
  const root = mkdtempSync(join(tmpdir(), "parameter-snapshot-"));
  const store = new Store(join(root, "library.sqlite"));
  try {
    const m = store.createMeeting("Parameters", null);
    m.analyses.push({
      id: randomUUID(),
      created: new Date().toISOString(),
      version: 0,
      raw: "{}",
      editedNotes: null,
      claims: [claim],
      visual: { revision: 1, frames: [frame] },
    });
    store.put("meetings", m);
    const historical = store.get<Meeting>("meetings", m.id);
    assert.match(markdown(historical), /to 80% capacity/);
    assert.equal(
      parameterText(historical.analyses[0].visual!.frames[0].parameters![0]),
      parameterText(frame.parameters![0]),
    );
  } finally {
    store.close();
  }
});

test("speech is analyzed once before visual additions; duplicate visual facts are rejected and baseline resumes after failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "visual-fusion-"));
  const audio = join(root, "audio");
  mkdirSync(audio);
  mkdirSync(join(root, "frames"));
  const store = new Store(join(root, "library.sqlite"));
  const m = store.createMeeting("Fusion", null);
  m.audio = `${m.id}.webm`;
  const segment = {
    id: randomUUID(),
    start: 0,
    end: 8,
    speaker: "speaker_0",
    text: "这是待评估方案。",
  };
  const frames: VisualFrame[] = [0, 5].map((start) => ({
    id: randomUUID(),
    file: `${randomUUID()}.jpg`,
    start,
    end: start + 5,
    title: "方案",
    text: "容量 80 Ah",
    uncertain: "",
    excluded: false,
    model: "test",
    contentType: "content",
    parameters: [
      {
        object: "Sample",
        metric: "Capacity",
        value: "80",
        unit: "Ah",
        conditions: [],
      },
    ],
  }));
  frames.forEach((f) => writeFileSync(join(root, "frames", f.file), "image"));
  m.video = {
    width: 100,
    height: 100,
    duration: 10,
    hasAudio: true,
    revision: 1,
    extracted: true,
    frames,
  };
  m.segments = [segment];
  m.status = "ready";
  store.put("meetings", m);
  const service = new Services(
    store,
    audio,
    () => ({
      asrUrl: "http://localhost",
      baseUrl: "http://localhost",
      model: "test",
      contextBudget: 65536,
      consent: true,
      visualConsent: true,
    }),
    () => "",
  );
  let speechCalls = 0,
    visualCalls = 0,
    fail = true;
  let omitNovel = true,
    feedbackSeen = false;
  let malformedReference = true,
    referenceFeedbackSeen = false;
  service.chat = async (_prompt, value: any) => {
    const language = languageFixture(value);
    if (language) return language;
    let result: unknown;
    if (value.proposedClaims) {
      assert.ok(
        !value.proposedClaims.some((c: Claim) => c.text === "重复语音候选"),
      );
      if (value.validationError?.includes("novel")) feedbackSeen = true;
      if (value.frames)
        assert.ok(
          value.existingClaims.some((c: Claim) => c.text === "方案仍待评估"),
        );
      if (value.frames && fail) {
        fail = false;
        throw new Error("temporary image review failure");
      }
      result = {
        reviews: value.proposedClaims.map((_: unknown, index: number) => ({
          index,
          supported: true,
          novel: !value.existingClaims?.some((c: Claim) =>
            c.text.startsWith("画面容量为80 Ah"),
          ),
          reason: "fixture",
        })),
      };
      if (value.frames && omitNovel) {
        omitNovel = false;
        (result as any).reviews.forEach((r: any) => delete r.novel);
      }
    } else if (value.sections) result = { supported: true };
    else if (value.claims)
      result = {
        sections: [
          {
            title: "展示内容",
            claimIndices: value.allowedIndices,
            children: [],
          },
        ],
      };
    else {
      if (value.frames) {
        visualCalls++;
        assert.equal(value.existingClaims, undefined);
        if (value.validationError?.includes("参数引用"))
          referenceFeedbackSeen = true;
      } else speechCalls++;
      result = {
        claims: [
          {
            kind: "summary",
            text: value.frames ? "画面容量为80 Ah" : "方案仍待评估",
            owner: null,
            due: null,
            targetId: null,
            change: "new",
            ...(value.frames
              ? { parameterRefs: [{ frameId: value.frames[0].id, index: 0 }] }
              : {}),
            evidence: value.frames
              ? [{ frameId: value.frames[0].id, quote: "容量 80 Ah" }]
              : [{ segmentId: segment.id, quote: segment.text }],
          },
        ],
      };
      if (value.frames && malformedReference) {
        malformedReference = false;
        (result as any).claims[0].evidence = [
          { segmentId: segment.id, quote: segment.text },
        ];
      }
      if (value.frames)
        (result as any).claims.push({
          kind: "summary",
          text: "重复语音候选",
          owner: null,
          due: null,
          targetId: null,
          change: "new",
          evidence: [{ segmentId: segment.id, quote: segment.text }],
        });
    }
    return { value: result, raw: JSON.stringify(result) };
  };
  const wait = async () => {
    while (service.controllers.size) await new Promise((r) => setTimeout(r, 5));
  };
  try {
    const job = service.start(m.id, "analyze", true);
    await wait();
    assert.equal(store.get<Job>("jobs", job.id).status, "failed");
    assert.equal(store.get<Job>("jobs", job.id).checkpoint?.length, 1);
    service.retry(job.id);
    await wait();
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    assert.equal(speechCalls, 1);
    assert.equal(feedbackSeen, true);
    assert.equal(visualCalls, 4);
    assert.equal(referenceFeedbackSeen, true);
    assert.ok(
      store
        .get<Job>("jobs", job.id)
        .checkpoint!.slice(1)
        .every((raw) => JSON.parse(raw).discardedSpeechOnly === 1),
    );
    assert.deepEqual(
      store
        .get<Meeting>("meetings", m.id)
        .analyses[0].claims.map((c) => c.text.split("\n")[0]),
      ["方案仍待评估", "画面容量为80 Ah"],
    );
  } finally {
    store.close();
  }
});
