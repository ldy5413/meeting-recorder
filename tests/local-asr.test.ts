import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../electron/store";
import { Services } from "../electron/services";
import {
  LocalAsr,
  type LocalAsrRunner,
  type LocalAsrRequest,
} from "../electron/local-asr";
import { contextOf } from "../shared/analysis";
import type { Job, Meeting, Settings } from "../shared/types";

const config: Settings = {
  asrMode: "local",
  asrUrl: "http://127.0.0.1:1",
  baseUrl: "http://127.0.0.1:1",
  model: "",
  contextBudget: 32768,
  consent: false,
};
const segment = () => ({
  id: randomUUID(),
  start: 0,
  end: 2,
  text: "Hello",
  speaker: "speaker-1",
});
async function settled(services: Services, id: string) {
  for (let i = 0; i < 200 && services.controllers.has(id); i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(services.controllers.has(id), false, "task did not finish");
  return services.store.get<Job>("jobs", id);
}
function fixture(runner: LocalAsrRunner) {
  const root = mkdtempSync(join(tmpdir(), "local-asr-test-"));
  const store = new Store(join(root, "db.sqlite"));
  const m = store.createMeeting("local", null);
  m.audio = "recording.wav";
  m.status = "ready";
  m.context = {
    ...contextOf(),
    transcriptionLanguage: "en",
    keywords: ["project"],
  };
  store.put("meetings", m);
  const services = new Services(
    store,
    root,
    () => config,
    () => {
      throw new Error("Local transcription requested a service secret");
    },
    runner,
  );
  return {
    store,
    m,
    services,
    close: () => {
      store.db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("local routing needs no external consent/key and freezes language/context across retries", async () => {
  const seen: LocalAsrRequest[] = [];
  const f = fixture({
    async run(request) {
      seen.push(request);
      if (seen.length === 1) throw new Error("test failure");
      return { segments: [segment()] };
    },
  });
  try {
    const job = f.services.start(f.m.id, "transcribe");
    assert.equal((await settled(f.services, job.id)).status, "failed");
    const changed = f.store.get<Meeting>("meetings", f.m.id);
    changed.context = {
      ...contextOf(),
      transcriptionLanguage: "zh",
      keywords: ["changed"],
    };
    f.store.put("meetings", changed);
    f.services.retry(job.id);
    assert.equal((await settled(f.services, job.id)).status, "complete");
    assert.deepEqual(
      seen.map((r) => r.language),
      ["en", "en"],
    );
    assert.deepEqual(seen[1].keywords, ["project"]);
    assert.equal(f.store.get<Meeting>("meetings", f.m.id).version, 1);
    assert.equal(f.store.get<Job>("jobs", job.id).remoteId, null);
  } finally {
    f.close();
  }
});

test("cancelled local work cannot save a late transcript; a new Chinese job routes independently", async () => {
  let complete!: (value: { segments: ReturnType<typeof segment>[] }) => void;
  let language = "";
  const f = fixture({
    run(request) {
      language = request.language;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  });
  try {
    f.m.context = contextOf();
    f.store.put("meetings", f.m);
    const job = f.services.start(f.m.id, "transcribe");
    assert.equal(language, "zh");
    await f.services.cancel(job.id);
    complete({ segments: [segment()] });
    assert.equal((await settled(f.services, job.id)).status, "cancelled");
    assert.equal(f.store.get<Meeting>("meetings", f.m.id).version, 0);
    assert.deepEqual(f.store.get<Meeting>("meetings", f.m.id).segments, []);
  } finally {
    f.close();
  }
});

test("missing bundled components fail clearly without leaving a transcript", async () => {
  const runner = new LocalAsr(
    join(tmpdir(), randomUUID()),
    join(tmpdir(), randomUUID()),
  );
  const f = fixture(runner);
  try {
    const job = f.services.start(f.m.id, "transcribe");
    const done = await settled(f.services, job.id);
    assert.equal(done.status, "failed");
    assert.match(done.error!, /本地转写组件不完整/);
    assert.equal(f.store.get<Meeting>("meetings", f.m.id).version, 0);
  } finally {
    f.close();
  }
});
