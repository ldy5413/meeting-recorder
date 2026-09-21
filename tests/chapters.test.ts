import { languageFixture, languageHttpFixture } from "./language-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Store } from "../electron/store";
import { Services } from "../electron/services";
import type { Job, Meeting } from "../shared/types";

test("truncated structured output is repaired once with the same allowed indices and remains audited", async () => {
  let requests = 0;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const input = JSON.parse(JSON.parse(body).messages[1].content);
    if (languageHttpFixture(input, res)) return;
    requests++;
    assert.deepEqual(input.allowedIndices, [0]);
    if (requests === 2) assert.ok(input.validationError && input.invalidOutput);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: requests === 1 ? "length" : "stop",
            message: {
              content:
                requests === 1 ? '{"indices":[0,1,2,' : '{"indices":[0]}',
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const store = new Store(
    join(mkdtempSync(join(tmpdir(), "truncated-repair-")), "library.sqlite"),
  );
  const service = new Services(
    store,
    "",
    () => ({
      asrUrl: "http://localhost",
      baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
      model: "test",
      contextBudget: 12000,
      consent: true,
    }),
    () => "",
  );
  try {
    const result = await service.groundedChat(
      "Return only allowed indices.",
      { allowedIndices: [0] },
      (value: any) => assert.deepEqual(value.indices, [0]),
    );
    assert.equal(requests, 2);
    const audit = JSON.parse(
      store.db
        .prepare("SELECT value FROM meta WHERE key=?")
        .get(result.auditId)!.value as string,
    );
    assert.equal(audit.attempts.length, 2);
    assert.equal(audit.attempts[0].raw, '{"indices":[0,1,2,');
    assert.match(audit.attempts[0].error, /截断/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});

test("long analyses organize in bounded requests and merge reviewed chapter trees without losing indices", async () => {
  const store = new Store(
    join(mkdtempSync(join(tmpdir(), "chapter-budget-")), "library.sqlite"),
  );
  const m = store.createMeeting("Long workshop", null);
  const segments = Array.from({ length: 30 }, (_, i) => ({
    id: randomUUID(),
    start: i * 20,
    end: i * 20 + 15,
    speaker: "speaker_0",
    text: `Fact ${i}: ${"Detailed observation. ".repeat(20)}`,
  }));
  store.saveTranscript(m.id, 0, segments, {});
  const service = new Services(
    store,
    "",
    () => ({
      asrUrl: "http://localhost",
      baseUrl: "http://localhost",
      model: "test",
      contextBudget: 12000,
      consent: true,
    }),
    () => "",
  );
  let chapters = 0,
    repairedIndices = false;
  service.chat = async (_system, data: any) => {
    const language = languageFixture(data);
    if (language) return language;
    let value;
    if (data.sections) {
      assert.ok(Buffer.byteLength(JSON.stringify(data)) < 8000);
      value = { supported: true };
    } else if (data.claims) {
      chapters++;
      assert.ok(Buffer.byteLength(JSON.stringify(data)) < 8000);
      if (data.validationError) {
        assert.match(data.validationError, /遗漏 \[1\]/);
        assert.match(data.validationError, /重复 \[0\]/);
        assert.match(data.validationError, /越界 \[999\]/);
        repairedIndices = true;
      }
      const indices = data.claims.map((_: unknown, i: number) => i);
      value = {
        sections: [
          {
            title: "技术内容",
            claimIndices: [],
            children: [
              {
                title: "测试观察",
                claimIndices:
                  chapters === 1 ? [0, 0, 999, ...indices.slice(2)] : indices,
                children: [],
              },
            ],
          },
        ],
      };
    } else if (data.proposedClaims)
      value = {
        reviews: data.proposedClaims.map((_: unknown, index: number) => ({
          index,
          supported: true,
          reason: "Supported",
        })),
      };
    else
      value = {
        claims: data.segments.map((s: (typeof segments)[number]) => ({
          kind: "summary",
          text: s.text,
          owner: null,
          due: null,
          targetId: null,
          change: "new",
          evidence: [{ segmentId: s.id, quote: s.text }],
        })),
      };
    return { value, raw: JSON.stringify(value) };
  };
  try {
    const job = service.start(m.id, "analyze");
    while (service.controllers.size) await new Promise((r) => setTimeout(r, 5));
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    const analysis = store.get<Meeting>("meetings", m.id).analyses[0];
    assert.ok(chapters > 1);
    assert.equal(repairedIndices, true);
    assert.equal(analysis.claims.length, 30);
    assert.equal(analysis.sections!.length, 1);
    assert.equal(analysis.sections![0].children.length, 1);
    assert.deepEqual(
      analysis.sections![0].children[0].claimIndices,
      Array.from({ length: 30 }, (_, i) => i),
    );
  } finally {
    store.close();
  }
});
