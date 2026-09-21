import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Store, checkEvidence, validateClaims } from "../electron/store";
import { Services } from "../electron/services";
import type { Meeting, Job, Project } from "../shared/types";

if (!process.argv[2] || !process.env.VLLM_BASE_URL || !process.env.VLLM_MODEL)
  throw new Error("请传入验证库目录并设置 VLLM_BASE_URL 和 VLLM_MODEL");
const root = resolve(process.argv[2]);
const store = new Store(join(root, "db.sqlite"));
store.recover();
const services = new Services(
  store,
  root,
  () => ({
    baseUrl: process.env.VLLM_BASE_URL!,
    model: process.env.VLLM_MODEL!,
    asrUrl: "http://127.0.0.1:8765",
    contextBudget: 65536,
    consent: true,
  }),
  () => "",
);
const report: any = {
  source:
    "existing Meetily transcripts, resumed final semantic-review pipeline",
  started: new Date().toISOString(),
  meetings: [],
};
try {
  for (const m of store.all<Meeting>("meetings")) {
    const started = Date.now();
    const previous = store
      .all<Job>("jobs")
      .find((j) => j.meetingId === m.id && j.kind === "analyze");
    const job =
      previous?.status === "complete"
        ? previous
        : previous
          ? services.retry(previous.id)
          : services.start(m.id, "analyze");
    let step = "";
    while (services.controllers.size) {
      const j = store.get<Job>("jobs", job.id);
      if (step !== j.step) {
        step = j.step;
        console.log(
          JSON.stringify({
            meeting: m.title,
            step,
            elapsedSeconds: (Date.now() - started) / 1000,
          }),
        );
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const finalJob = store.get<Job>("jobs", job.id),
      latest = store.get<Meeting>("meetings", m.id),
      analysis = latest.analyses.at(-1);
    if (analysis) validateClaims(analysis.claims, m.segments, []);
    const checkpoints = (finalJob.checkpoint ?? []).map((raw) =>
      JSON.parse(raw),
    );
    report.meetings.push({
      id: m.id,
      segments: m.segments.length,
      status: finalJob.status,
      error: finalJob.error,
      resumeSeconds: (Date.now() - started) / 1000,
      claims: analysis?.claims.length ?? 0,
      evidence: analysis?.claims.flatMap((c) => c.evidence).length ?? 0,
      generated: checkpoints.reduce(
        (n, c) => n + JSON.parse(c.generationRaw).claims.length,
        0,
      ),
      rejected: checkpoints.reduce(
        (n, c) =>
          n +
          JSON.parse(c.verificationRaw).reviews.filter((r: any) => !r.supported)
            .length,
        0,
      ),
    });
    console.log(JSON.stringify(report.meetings.at(-1)));
    writeFileSync(
      join(root, "final-report.json"),
      JSON.stringify(report, null, 2),
    );
  }
  const started = Date.now();
  try {
    const project = store.all<Project>("projects")[0];
    const answer = await services.ask(
      "What was discussed about CVD and DOE?",
      project.id,
      null,
      "",
      "",
    );
    checkEvidence(
      answer.evidence,
      store.all<Meeting>("meetings").flatMap((m) => m.segments),
    );
    writeFileSync(
      join(root, "final-answer.json"),
      JSON.stringify(answer, null, 2),
    );
    report.qa = {
      status: "complete",
      evidence: answer.evidence.length,
      meetingCount: new Set(
        answer.evidence.map((e) => store.resolveEvidence(e).meetingId),
      ).size,
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
  writeFileSync(
    join(root, "final-report.json"),
    JSON.stringify(report, null, 2),
  );
  store.close();
  console.log(JSON.stringify(report));
}
