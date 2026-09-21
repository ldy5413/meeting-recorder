import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../electron/store";
import { Services } from "../electron/services";
import { frameImage } from "../electron/video";
import type { Job, Meeting, Settings, VisualFrame } from "../shared/types";

test("dense frame truncation increases the output budget, preserves completed frames and audits reasoning separately", async () => {
  const root = mkdtempSync(join(tmpdir(), "frame-output-budget-"));
  for (const folder of ["audio", "frames"]) mkdirSync(join(root, folder));
  const store = new Store(join(root, "library.sqlite"));
  const m = store.createMeeting("Dense table", null);
  const parameter = {
    object: "Sample",
    metric: "Cycle life",
    value: ">1000",
    unit: "cycles",
    conditions: ["to 80% capacity", "25 C"],
  };
  const frames: VisualFrame[] = [0, 10].map((start) => ({
    id: randomUUID(),
    file: `${randomUUID()}.jpg`,
    start,
    end: start + 10,
    title: "",
    text: "",
    uncertain: "",
    excluded: false,
  }));
  for (const f of frames)
    writeFileSync(join(root, "frames", f.file), "same fixture bytes");
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    requests.push(body);
    const current = store.get<Meeting>("meetings", m.id);
    assert.equal(current.video!.frames[1].model, undefined);
    assert.deepEqual(current.video!.frames[0], frames[0]);
    const value = {
      contentType: "content",
      title: "Complete table",
      text: "A measured specification",
      uncertain: "",
      parameters: [parameter],
    };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: requests.length === 1 ? "length" : "stop",
            message:
              requests.length === 1
                ? {
                    content: "",
                    reasoning_content:
                      "Model reasoning consumed the output allowance",
                  }
                : { content: JSON.stringify(value) },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const config: Settings = {
    asrUrl: "http://localhost",
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
    model: "fixture",
    contextBudget: 65536,
    maxOutputTokens: 16384,
    thinkingMode: "disabled",
    consent: true,
    visualConsent: true,
  };
  Object.assign(frames[0], {
    model: config.model,
    contentType: "content",
    parameters: [parameter],
    title: "Previous observation",
    text: "Existing evidence",
    observationSource: { baseUrl: config.baseUrl, model: config.model },
    imageHash: createHash("sha256")
      .update(await frameImage(join(root, "frames"), frames[0]))
      .digest("hex"),
  });
  m.audio = `${m.id}.webm`;
  m.video = {
    duration: 20,
    width: 320,
    height: 180,
    hasAudio: false,
    revision: 1,
    extracted: true,
    frames,
  };
  store.put("meetings", m);
  const service = new Services(
    store,
    join(root, "audio"),
    () => config,
    () => "",
  );
  try {
    const job = service.start(m.id, "visuals");
    const steps: string[] = [];
    const deadline = Date.now() + 10000;
    while (service.controllers.size) {
      steps.push(store.get<Job>("jobs", job.id).step);
      assert.ok(Date.now() < deadline, "job stalled");
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    assert.ok(steps.some((s) => s.includes("2/2") && s.includes("1/1")));
    assert.deepEqual(
      requests.map((r) => r.max_tokens),
      [8192, 16384],
    );
    for (const request of requests) {
      assert.deepEqual(request.chat_template_kwargs, {
        enable_thinking: false,
      });
      assert.equal(
        request.messages[1].content[1].image_url.url,
        requests[0].messages[1].content[1].image_url.url,
      );
    }
    const current = store.get<Meeting>("meetings", m.id);
    assert.deepEqual(current.video!.frames[0], frames[0]);
    assert.deepEqual(current.video!.frames[1].parameters, [parameter]);
    assert.equal(
      current.video!.frames[1].observationSource?.thinkingMode,
      "disabled",
    );
    const audits = store.db
      .prepare("SELECT value FROM meta WHERE key LIKE 'chat-audit:%'")
      .all()
      .map((row) => JSON.parse(String(row.value)));
    assert.deepEqual(
      audits.map((a) => a.maxTokens),
      [8192, 16384],
    );
    assert.ok(audits[0].response.choices[0].message.reasoning_content);
    assert.ok(!current.video!.frames[1].text.includes("reasoning"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});

test("output retries respect the configured ceiling and remaining context, and default mode sends no vendor fields", async () => {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    requests.push(JSON.parse(raw));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          { finish_reason: "length", message: { content: '{"ok":true}' } },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const store = new Store(
    join(mkdtempSync(join(tmpdir(), "bounded-output-")), "db.sqlite"),
  );
  const config: Settings = {
    asrUrl: "http://localhost",
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
    model: "fixture",
    contextBudget: 20000,
    maxOutputTokens: 6000,
    consent: true,
  };
  const service = new Services(
    store,
    "",
    () => config,
    () => "",
  );
  try {
    await assert.rejects(
      service.groundedChat("JSON", {}, () => {}, undefined, [], {
        maxTokens: 4096,
      }),
      /6000 tokens/,
    );
    assert.deepEqual(
      requests.map((r) => r.max_tokens),
      [4096, 6000],
    );
    assert.ok(requests.every((r) => !("chat_template_kwargs" in r)));
    requests.length = 0;
    config.contextBudget = 65536;
    config.maxOutputTokens = 32768;
    await assert.rejects(
      service.groundedChat("JSON", {}, () => {}),
      /32768 tokens/,
    );
    assert.deepEqual(
      requests.map((r) => r.max_tokens),
      [4096, 32768],
    );
    requests.length = 0;
    config.contextBudget = 4096;
    config.maxOutputTokens = 32768;
    const data = { text: "x".repeat(1800) };
    await assert.rejects(
      service.groundedChat("JSON", data, () => {}),
      /截断/,
    );
    assert.equal(requests.length, 2);
    for (const request of requests) {
      const input = request.messages[0].content + request.messages[1].content;
      assert.ok(
        Buffer.byteLength(input) + 256 + request.max_tokens <=
          config.contextBudget,
      );
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});
