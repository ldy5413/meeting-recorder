import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Store, checkEvidence, validateClaims } from "../electron/store";
import { Services } from "../electron/services";
import type { Job, Meeting } from "../shared/types";

// Explicit opt-in integration runner. Source files remain read-only; results are private.
const sources = process.argv.slice(2);
const baseUrl = process.env.VLLM_BASE_URL;
if (!baseUrl || !sources.length)
  throw new Error("请设置 VLLM_BASE_URL 并传入用户授权的会议目录");
const models = (await (await fetch(`${baseUrl}/models`)).json()) as any;
const model = process.env.VLLM_MODEL ?? models.data[0].id;
const root = resolve(
  ".local/vllm-validation",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
mkdirSync(root, { recursive: true });
const store = new Store(join(root, "db.sqlite"));
const project = store.createProject("真实会议分析验证（Meetily 已有转录）");
const services = new Services(
  store,
  root,
  () => ({
    asrUrl: "http://127.0.0.1:8765",
    baseUrl,
    model,
    contextBudget: 65536,
    consent: true,
  }),
  () => "",
);
const report: any = {
  source: "existing Meetily transcripts.json, not VibeVoice output",
  baseUrl,
  model,
  contextBudget: 65536,
  started: new Date().toISOString(),
  meetings: [],
};
try {
  for (const [index, source] of sources.entries()) {
    const input = JSON.parse(
      readFileSync(join(source, "transcripts.json"), "utf8"),
    );
    const m = store.createMeeting(
      `真实会议 ${index + 1}（Meetily）`,
      project.id,
    );
    const segments = input.segments.map((s: any) => ({
      id: randomUUID(),
      start: s.audio_start_time,
      end: s.audio_end_time,
      speaker: "unknown",
      text: s.text,
    }));
    store.saveTranscript(
      m.id,
      m.version,
      segments,
      {},
      JSON.stringify({ source: "Meetily", input }),
    );
    const started = Date.now();
    const job = services.start(m.id, "analyze");
    let step = "";
    while (services.controllers.size) {
      const j = store.get<Job>("jobs", job.id);
      if (j.step !== step) {
        step = j.step;
        console.log(
          JSON.stringify({
            meeting: index + 1,
            step,
            elapsedSeconds: (Date.now() - started) / 1000,
          }),
        );
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const result = store.get<Job>("jobs", job.id);
    const latest = store.get<Meeting>("meetings", m.id);
    const analysis = latest.analyses.at(-1);
    if (analysis) validateClaims(analysis.claims, segments, []);
    report.meetings.push({
      meeting: index + 1,
      segments: segments.length,
      transcriptEndSeconds: segments.at(-1)?.end,
      status: result.status,
      error: result.error,
      elapsedSeconds: (Date.now() - started) / 1000,
      claims: analysis?.claims.length ?? 0,
      evidence:
        analysis?.claims.reduce((n, c) => n + c.evidence.length, 0) ?? 0,
    });
    writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.meetings.at(-1)));
  }
  const started = Date.now();
  try {
    const answer = await services.ask(
      "总结会议中关于模型的讨论",
      project.id,
      null,
      "",
      "",
    );
    checkEvidence(
      answer.evidence,
      store.all<Meeting>("meetings").flatMap((m) => m.segments),
    );
    writeFileSync(join(root, "answer.json"), JSON.stringify(answer, null, 2));
    report.qa = {
      status: "complete",
      evidence: answer.evidence.length,
      coverage: answer.coverage,
      elapsedSeconds: (Date.now() - started) / 1000,
    };
  } catch (e) {
    report.qa = {
      status: "failed",
      error: String(e),
      elapsedSeconds: (Date.now() - started) / 1000,
    };
  }
} finally {
  report.finished = new Date().toISOString();
  writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2));
  store.close();
  console.log(JSON.stringify({ report: join(root, "report.json"), ...report }));
}
