import { languageHttpFixture } from "./language-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeAnonymousOwners } from "../electron/claim-ownership";
import { Store, validateClaims } from "../electron/store";
import { Services } from "../electron/services";
import { isAnonymousSpeakerLabel } from "../shared/speakers";
import { mergeApprovedClaims } from "../shared/analysis";
import type { Claim, Job, Meeting } from "../shared/types";

test("anonymous owners become unconfirmed while evidence, actions, real names and distinct voices are preserved", () => {
  const segments = ["speaker-1", "speaker-2"].map((speaker) => ({
    id: randomUUID(),
    start: 0,
    end: 2,
    speaker,
    text: "我下周找公开测试数据。",
  }));
  const claim: Claim = {
    kind: "todo",
    text: "查找公开测试数据",
    owner: "speaker-2",
    due: "下周",
    evidence: [{ segmentId: segments[1].id, quote: segments[1].text }],
    targetId: null,
    change: "new",
  };
  const labels = [
    "speaker-2",
    " SPEAKER_02 ",
    "Speaker 2",
    "ＳＰＥＡＫＥＲ－２",
    "spk0",
    "unknown",
    "unresolved-1",
    "说话人 2",
    "待确认 1",
    "未确认人员",
    "non-speech",
  ];
  for (const owner of labels) {
    assert.equal(isAnonymousSpeakerLabel(owner), true);
    const raw = { ...claim, owner },
      baseline = JSON.stringify(raw);
    const normalized = normalizeAnonymousOwners([raw]);
    assert.equal(normalized.claims[0].owner, null);
    assert.deepEqual(normalized.claims[0], { ...raw, owner: null });
    assert.equal(normalized.ownerAdjustments[0].originalOwner, owner);
    assert.equal(JSON.stringify(raw), baseline);
    validateClaims(normalized.claims, segments, []);
    assert.throws(
      () => validateClaims([raw], segments, [], { "speaker-2": owner }),
      /匿名说话人标签/,
    );
  }
  const named = { ...claim, owner: "李四" };
  assert.deepEqual(normalizeAnonymousOwners([named]), {
    claims: [named],
    ownerAdjustments: [],
  });
  validateClaims([named], segments, [], { "speaker-2": "李四" });
  assert.throws(
    () =>
      validateClaims(
        normalizeAnonymousOwners([{ ...claim, owner: "王五" }]).claims,
        segments,
        [],
        { "speaker-2": "李四" },
      ),
    /负责人/,
  );
  assert.throws(
    () =>
      validateClaims(
        [
          {
            ...claim,
            evidence: [{ segmentId: segments[1].id, quote: "不存在的引文" }],
          },
        ],
        segments,
        [],
      ),
    /引文与原文不一致/,
  );
  const anonymous = normalizeAnonymousOwners(
    segments.map((s) => ({
      ...claim,
      owner: s.speaker,
      evidence: [{ segmentId: s.id, quote: s.text }],
    })),
  ).claims;
  assert.equal(mergeApprovedClaims(anonymous, segments, {}).length, 2);
});

test("quote retry can finish with an anonymous owner, semantic review still rejects unsupported work, and later retry reuses the checkpoint", async () => {
  const store = new Store(
    join(mkdtempSync(join(tmpdir(), "anonymous-owner-")), "library.sqlite"),
  );
  const meeting = store.createMeeting(
    "Ownership fixture",
    store.createProject("Fixture project").id,
  );
  const segments = [
    "我下周找公开测试数据。",
    "我只是看看，还没决定是否投入。",
  ].map((text, i) => ({
    id: randomUUID(),
    speaker: "speaker-2",
    start: i * 3,
    end: i * 3 + 2,
    text,
  }));
  store.saveTranscript(meeting.id, 0, segments, {});
  let generations = 0,
    reviews = 0,
    failOrganization = true;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(JSON.parse(body).messages[1].content);
    if (languageHttpFixture(input, response)) return;
    let value: unknown;
    if (input.proposedClaims) {
      reviews++;
      assert.ok(input.proposedClaims.every((c: Claim) => c.owner === null));
      value = {
        reviews: [
          { index: 0, supported: true, reason: "明确行动" },
          { index: 1, supported: false, reason: "未作决定" },
        ],
      };
    } else if (input.sections) value = { supported: true };
    else if (input.claims) {
      if (failOrganization) {
        failOrganization = false;
        response.statusCode = 503;
        response.end("Temporary fixture outage");
        return;
      }
      value = {
        sections: [
          {
            title: "后续工作",
            claimIndices: input.allowedIndices,
            children: [],
          },
        ],
      };
    } else {
      generations++;
      if (generations === 2) assert.ok(input.invalidReferences.length);
      value = {
        claims: segments.map((segment, i) => ({
          kind: i ? "decision" : "todo",
          text: i ? "已决定投入项目" : "查找公开测试数据",
          owner: "speaker-2",
          due: i ? null : "下周",
          evidence: [
            {
              segmentId: segment.id,
              quote:
                !i && generations === 1
                  ? "我下周...公开测试数据。"
                  : segment.text,
            },
          ],
          targetId: null,
          change: "new",
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
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const service = new Services(
    store,
    "",
    () => ({
      baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
      asrUrl: "http://localhost",
      model: "fixture",
      contextBudget: 32768,
      consent: true,
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
    assert.match(failed.error!, /503/);
    assert.equal(failed.checkpoint!.length, 1);
    const checkpoint = failed.checkpoint![0],
      parsed = JSON.parse(checkpoint);
    assert.equal(parsed.ownerAdjustments.length, 2);
    assert.equal(parsed.claims.length, 1);
    assert.equal(parsed.claims[0].owner, null);
    assert.equal(parsed.claims[0].due, "下周");
    assert.equal(JSON.parse(parsed.generationRaw).claims[0].owner, "speaker-2");
    service.retry(job.id);
    await wait();
    const done = store.get<Job>("jobs", job.id);
    assert.equal(done.status, "complete", done.error ?? "");
    assert.equal(done.checkpoint![0], checkpoint);
    assert.equal(generations, 2);
    assert.equal(reviews, 1);
    const analysis = store.get<Meeting>("meetings", meeting.id).analyses[0];
    assert.equal(analysis.claims.length, 1);
    assert.equal(store.accept(meeting.id, analysis.id, 0).owner, null);
    const audit = store.db
      .prepare(
        "SELECT value FROM meta WHERE key LIKE 'analysis-audit:%' ORDER BY rowid DESC LIMIT 1",
      )
      .get()!;
    assert.equal(JSON.parse(String(audit.value)).ownerAdjustments.length, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});
