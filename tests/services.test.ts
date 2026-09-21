import { languageFixture, languageHttpFixture } from "./language-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/store";
import { Services, endpoint } from "../electron/services";
import type { Job, Meeting, Settings } from "../shared/types";
import { contextOf } from "../shared/analysis";

test("configured private IPv4 HTTP endpoints and public HTTPS", () => {
  for (const host of [
    "10.1.2.3",
    "172.16.0.1",
    "172.20.0.10",
    "172.31.255.254",
    "192.168.2.1",
  ])
    assert.equal(
      endpoint(`http://${host}:8000/v1`, "chat/completions"),
      `http://${host}:8000/v1/chat/completions`,
    );
  for (const host of [
    "172.15.255.255",
    "172.32.0.1",
    "192.169.0.1",
    "8.8.8.8",
    "example.com",
    "172.20.0.10.example.com",
  ])
    assert.throws(() => endpoint(`http://${host}`, "jobs"));
  assert.throws(() => endpoint("http://user:password@172.20.0.10", "jobs"));
});

test("failed upload explains connectivity and retry uses corrected URL without creating another job", async () => {
  const root = mkdtempSync(join(tmpdir(), "upload-retry-"));
  const store = new Store(join(root, "db.sqlite"));
  const meeting = store.createMeeting("retry", null);
  meeting.audio = "test.wav";
  meeting.context = { ...contextOf(), background: "original ASR context" };
  writeFileSync(join(root, meeting.audio), "audio");
  store.put("meetings", meeting);
  const remoteId = randomUUID();
  let uploads = 0;
  let uploadBody = "";
  const server = createServer(async (req, res) => {
    for await (const _part of req) {
      uploadBody += _part.toString();
    }
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      uploads++;
      res.end(JSON.stringify({ id: remoteId }));
    } else res.end(JSON.stringify({ status: "complete", segments: [] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const settings: Settings = {
    asrUrl: "http://127.0.0.1:1",
    baseUrl: "http://localhost",
    model: "",
    contextBudget: 32768,
    consent: true,
  };
  const services = new Services(
    store,
    root,
    () => settings,
    () => "",
  );
  const wait = async () => {
    const deadline = Date.now() + 5000;
    while (services.controllers.size) {
      if (Date.now() > deadline) throw new Error("task timeout");
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  try {
    const job = services.start(meeting.id, "transcribe");
    await wait();
    const failed = store.get<Job>("jobs", job.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error!, /无法连接转录服务 http:\/\/127.0.0.1:1/);
    assert.match(failed.error!, /启动转录服务/);
    settings.asrUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    store.configure("meetings", meeting.id, {
      ...contextOf(),
      background: "changed ASR context",
    });
    services.retry(job.id);
    assert.throws(() => services.retry(job.id));
    await wait();
    assert.match(uploadBody, /original ASR context/);
    assert.ok(!uploadBody.includes("changed ASR context"));
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    assert.equal(store.get<Job>("jobs", job.id).remoteUrl, settings.asrUrl);
    assert.equal(store.all<Job>("jobs").length, 1);
    assert.equal(uploads, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});

test("real HTTP grounding feedback retries once and audits rejected raw responses", async () => {
  let calls = 0,
    repair = true;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const input = JSON.parse(JSON.parse(body).messages[1].content);
    if (languageHttpFixture(input, res)) return;
    calls++;
    if (calls % 2 === 0) {
      assert.equal(input.validationError, "quote mismatch");
      assert.ok(input.invalidOutput);
      assert.equal(input.segments[0].text, "原文");
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                quote: repair && calls % 2 === 0 ? "原文" : "拼接原文",
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const store = new Store(
    join(mkdtempSync(join(tmpdir(), "feedback-")), "db.sqlite"),
  );
  const service = new Services(
    store,
    "",
    () => ({
      baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
      asrUrl: "http://localhost",
      model: "test",
      contextBudget: 32768,
      consent: true,
    }),
    () => "",
  );
  const validate = (value: any) => {
    if (value.quote !== "原文") throw new Error("quote mismatch");
  };
  try {
    const result = await service.groundedChat(
      "JSON",
      { segments: [{ text: "原文" }] },
      validate,
    );
    assert.equal(result.value.quote, "原文");
    const feedback = service.referenceFeedback(
      { evidence: [{ segmentId: "wrong", quote: "原文" }] },
      {
        segments: [
          { id: "wrong", text: "另一句" },
          { id: "right", text: "这里的原文" },
        ],
      },
    );
    assert.deepEqual(feedback, [
      {
        segmentId: "wrong",
        quote: "原文",
        actualSegmentText: "另一句",
        exactMatchingSegmentIds: ["right"],
      },
    ]);
    assert.deepEqual(
      service.referenceFeedback(
        { evidence: [{ segmentId: "wrong", quote: "原文" }] },
        {
          chronologicalSummaries: [
            { evidence: [{ segmentId: "right", quote: "原文" }] },
          ],
        },
      )[0].exactMatchingSegmentIds,
      ["right"],
    );
    assert.equal(calls, 2);
    const audit = JSON.parse(
      store.db
        .prepare("SELECT value FROM meta WHERE key=?")
        .get(result.auditId)!.value as string,
    );
    assert.equal(audit.attempts.length, 2);
    assert.equal(audit.attempts[0].error, "quote mismatch");
    assert.equal(JSON.parse(audit.attempts[0].raw).quote, "拼接原文");
    repair = false;
    await assert.rejects(
      service.groundedChat("JSON", { segments: [{ text: "原文" }] }, validate),
      /quote mismatch/,
    );
    assert.equal(calls, 4);
    const audits = store.db
      .prepare("SELECT value FROM meta WHERE key LIKE 'grounding-audit:%'")
      .all();
    assert.equal(audits.length, 2);
    assert.ok(
      audits.some((row) =>
        JSON.parse(row.value as string).attempts.every(
          (a: any) => a.error === "quote mismatch",
        ),
      ),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});

test("chat ignores separate reasoning and rejects truncated or malformed JSON", async () => {
  let choice: unknown = {
    finish_reason: "stop",
    message: {
      content: '{"ok":true}',
      reasoning: "private reasoning is not the answer",
    },
  };
  const server = createServer(async (req, res) => {
    for await (const _part of req) {
      /* drain request */
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [choice] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const store = new Store(
    join(mkdtempSync(join(tmpdir(), "chat-output-")), "db.sqlite"),
  );
  const service = new Services(
    store,
    "",
    () => ({
      baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
      asrUrl: "http://localhost",
      model: "test",
      contextBudget: 32768,
      consent: true,
    }),
    () => "",
  );
  try {
    assert.deepEqual((await service.chat("JSON", {})).value, { ok: true });
    choice = { finish_reason: "length", message: { content: '{"ok":true}' } };
    await assert.rejects(service.chat("JSON", {}), /截断/);
    choice = { finish_reason: "stop", message: { content: "not JSON" } };
    await assert.rejects(service.chat("JSON", {}), SyntaxError);
    choice = {
      finish_reason: "stop",
      message: { content: null, reasoning: '{"ok":true}' },
    };
    await assert.rejects(service.chat("JSON", {}), /缺少文本/);
    const audits = store.db
      .prepare("SELECT value FROM meta WHERE key LIKE 'chat-audit:%'")
      .all()
      .map((r) => JSON.parse(r.value as string));
    assert.equal(audits.length, 4);
    assert.ok(
      audits.some((a) => a.response.choices[0].finish_reason === "length"),
    );
    assert.ok(
      audits.some((a) => a.response.choices[0].message.content === "not JSON"),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});

test("semantic review drops unsupported claims and preserves both original responses", async () => {
  const store = new Store(
    join(mkdtempSync(join(tmpdir(), "semantic-review-")), "db.sqlite"),
  );
  const meeting = store.createMeeting("review", null);
  const segment = {
    id: randomUUID(),
    start: 0,
    end: 1,
    speaker: "unknown",
    text: "王老师，周末打扰了。",
  };
  store.saveTranscript(meeting.id, 0, [segment], {});
  const service = new Services(
    store,
    "",
    () => ({
      baseUrl: "http://localhost/v1",
      asrUrl: "http://localhost",
      model: "test",
      contextBudget: 32768,
      consent: true,
    }),
    () => "",
  );
  const claim = {
    kind: "todo",
    text: "王老师周末处理事务",
    owner: "王老师",
    due: "周末",
    evidence: [{ segmentId: segment.id, quote: segment.text }],
    targetId: null,
    change: "new",
  };
  let incomplete = false;
  service.chat = async (_system, data: any) => {
    const language = languageFixture(data);
    if (language) return language;
    const value = data.proposedClaims
      ? {
          reviews: incomplete
            ? []
            : [
                {
                  index: 0,
                  supported: false,
                  reason: "寒暄不构成任务、负责人或截止时间",
                },
              ],
        }
      : { claims: [claim] };
    return { raw: JSON.stringify(value), value };
  };
  const wait = async () => {
    while (service.controllers.size) await new Promise((r) => setTimeout(r, 5));
  };
  try {
    const job = service.start(meeting.id, "analyze");
    await wait();
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    const analysis = store.get<Meeting>("meetings", meeting.id).analyses[0];
    assert.deepEqual(analysis.claims, []);
    const checkpoint = JSON.parse(
      store.get<Job>("jobs", job.id).checkpoint![0],
    );
    assert.deepEqual(JSON.parse(checkpoint.generationRaw).claims, [claim]);
    assert.equal(
      JSON.parse(checkpoint.verificationRaw).reviews[0].supported,
      false,
    );
    incomplete = true;
    const failed = service.start(meeting.id, "analyze");
    await wait();
    assert.equal(store.get<Job>("jobs", failed.id).status, "failed");
    assert.match(store.get<Job>("jobs", failed.id).error!, /未完整覆盖/);
    assert.equal(store.get<Meeting>("meetings", meeting.id).analyses.length, 1);
    assert.equal(
      store.db
        .prepare(
          "SELECT count(*) n FROM meta WHERE key LIKE 'analysis-audit:%'",
        )
        .get()!.n,
      2,
    );
  } finally {
    store.close();
  }
});

test("real HTTP task contract, upload, transcript save, grounded analysis and project QA", async () => {
  const root = mkdtempSync(join(tmpdir(), "service-contract-"));
  mkdirSync(join(root, "audio"));
  const store = new Store(join(root, "db.sqlite"));
  const project = store.createProject("Contract"),
    m = store.createMeeting("API review", project.id);
  m.audio = `${m.id}.wav`;
  writeFileSync(join(root, "audio", m.audio), "test audio");
  store.put("meetings", m);
  const segment = {
    id: randomUUID(),
    start: 0,
    end: 2,
    speaker: "chunk-1:speaker-1",
    text: "我们决定使用 SQLite。",
  };
  const remoteId = randomUUID();
  let uploads = 0;
  let chatCalls = 0;
  let polls = 0;
  let sawQueue = false;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/jobs" && req.method === "POST") {
      assert.match(body, /test audio/);
      assert.ok(req.headers["idempotency-key"]);
      uploads++;
      res.end(JSON.stringify({ id: remoteId }));
    } else if (req.url === `/jobs/${remoteId}`) {
      if (polls++ === 0) {
        res.end(
          JSON.stringify({
            status: "queued",
            step: "cancelled",
            completed_chunks: 0,
            total_chunks: 1,
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          id: remoteId,
          status: "complete",
          segments: [segment],
        }),
      );
    } else if (req.url === "/v1/chat/completions") {
      chatCalls++;
      const request = JSON.parse(body),
        data = JSON.parse(request.messages[1].content);
      if (languageHttpFixture(data, res)) return;
      const value = data.sections
        ? { supported: true }
        : data.claims
          ? {
              sections: [
                {
                  title: "决策",
                  claimIndices: data.claims.map((_: unknown, i: number) => i),
                  children: [],
                },
              ],
            }
          : data.proposedClaims
            ? {
                reviews: data.proposedClaims.map(
                  (_: unknown, index: number) => ({
                    index,
                    supported: true,
                    reason: "Explicit decision supported by the quote",
                  }),
                ),
              }
            : data.question
              ? {
                  text: `已决定使用 SQLite。[${segment.id}]`,
                  evidence: [{ segmentId: segment.id, quote: segment.text }],
                }
              : {
                  claims: [
                    {
                      kind: "decision",
                      text: "使用 SQLite",
                      owner: null,
                      due: null,
                      targetId: null,
                      change: "new",
                      evidence: [
                        { segmentId: segment.id, quote: segment.text },
                      ],
                    },
                  ],
                };
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(value) },
            },
          ],
        }),
      );
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const settings: Settings = {
    asrUrl: `http://127.0.0.1:${port}`,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: "contract-test",
    contextBudget: 32768,
    consent: true,
  };
  const services = new Services(
    store,
    join(root, "audio"),
    () => settings,
    () => "",
  );
  const wait = async () => {
    const deadline = Date.now() + 10000;
    while (services.controllers.size) {
      sawQueue ||= store
        .all<Job>("jobs")
        .some((j) => j.step === "等待转录服务队列（0/1）");
      if (Date.now() > deadline) throw new Error("task timeout");
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  try {
    const job = services.start(m.id, "transcribe");
    await wait();
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    assert.equal(uploads, 1);
    assert.equal(sawQueue, true);
    assert.deepEqual(store.get<Meeting>("meetings", m.id).segments, [segment]);
    const a = services.start(m.id, "analyze");
    await wait();
    assert.equal(store.get<Job>("jobs", a.id).status, "complete");
    const meeting = store.get<Meeting>("meetings", m.id);
    assert.equal(meeting.analyses[0].claims.length, 1);
    assert.equal(store.all("records").length, 0);
    store.accept(m.id, meeting.analyses[0].id, 0);
    assert.equal(store.all("records").length, 1);
    const answer = await services.ask("SQLite", project.id, null, "", "");
    assert.equal(answer.evidence[0].segmentId, segment.id);
    assert.equal(chatCalls, 7); // Includes report and answer language resolution.
    const checkpoint = JSON.parse(store.get<Job>("jobs", a.id).checkpoint![0]);
    assert.ok(checkpoint.generationRaw);
    assert.ok(checkpoint.verificationRaw);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});
