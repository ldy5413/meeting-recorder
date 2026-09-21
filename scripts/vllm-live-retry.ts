import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkEvidence, validateClaims } from "../electron/store";
import type { State } from "../shared/types";
import { request as httpRequest } from "node:http";
const [reportDirectory, id] = process.argv.slice(2);
if (!reportDirectory || !id)
  throw new Error(
    "用法: npx tsx scripts/vllm-live-retry.ts <已有报告目录> <会议ID>",
  );
const root = resolve(reportDirectory);
async function request(input: unknown) {
  const { origin, token } = JSON.parse(
    readFileSync(
      join(
        process.env.LOCALAPPDATA!,
        "MeetingRecorder-dev-browser/dev-bridge.json",
      ),
      "utf8",
    ),
  );
  const b: any = await new Promise((resolve, reject) => {
    const r = httpRequest(
      `${origin}/api/request`,
      {
        method: "POST",
        headers: {
          Origin: origin,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (part) => (body += part));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
        res.on("error", reject);
      },
    );
    r.setTimeout(900000, () =>
      r.destroy(new Error("bridge request exceeded 900 seconds")),
    );
    r.on("error", reject);
    r.end(JSON.stringify(input));
  });
  if (!b.ok) throw new Error(b.error);
  return b.value;
}
let state: State = await request({ op: "state" });
const job = state.jobs.find((j) => j.meetingId === id && j.kind === "analyze")!;
const report: any = {
  source: "actual VibeVoice, single-segment quote prompt retry",
  started: new Date().toISOString(),
};
const started = Date.now();
const priorReport = JSON.parse(
  readFileSync(join(root, "final-report.json"), "utf8"),
);
if (job.status !== "complete") await request({ op: "job.retry", id: job.id });
let step = "";
while (true) {
  state = await request({ op: "state" });
  const j = state.jobs.find((j) => j.id === job.id)!;
  if (step !== j.step) {
    step = j.step;
    console.log(JSON.stringify({ status: j.status, step, error: j.error }));
  }
  if (!["queued", "running"].includes(j.status)) break;
  await new Promise((r) => setTimeout(r, 3000));
}
const m = state.meetings.find((m) => m.id === id)!,
  a = m.analyses.at(-1),
  j = state.jobs.find((j) => j.id === job.id)!;
if (a)
  validateClaims(
    a.claims,
    m.segments,
    state.records.filter((r) => r.projectId === m.projectId),
  );
const cps = (j.checkpoint ?? []).map((x) => JSON.parse(x));
report.analysis = {
  status: j.status,
  error: j.error,
  seconds: (Date.now() - started) / 1000,
  claims: a?.claims.length ?? 0,
  evidence: a?.claims.flatMap((c) => c.evidence).length ?? 0,
  generated: cps.reduce(
    (n, c) => n + JSON.parse(c.generationRaw).claims.length,
    0,
  ),
  rejected: cps.reduce(
    (n, c) =>
      n +
      JSON.parse(c.verificationRaw).reviews.filter((r: any) => !r.supported)
        .length,
    0,
  ),
};
if (job.status === "complete" && priorReport.analysis?.status === "complete")
  report.analysis = priorReport.analysis;
writeFileSync(
  join(root, "july-final.json"),
  JSON.stringify({ meeting: m, job: j }, null, 2),
);
console.log(JSON.stringify(report.analysis));
const qaStart = Date.now();
try {
  const answer = await request({
    op: "ask",
    question: "这两场会议讨论了哪些待办和决定？请只回答有原文依据的内容。",
    projectId: m.projectId,
    meetingId: null,
    from: "",
    to: "",
  });
  const meetings = state.meetings.filter((x) => x.projectId === m.projectId);
  checkEvidence(
    answer.evidence,
    meetings.flatMap((m) => m.segments),
  );
  writeFileSync(
    join(root, "answer-final.json"),
    JSON.stringify(answer, null, 2),
  );
  report.qa = {
    status: "complete",
    evidence: answer.evidence.length,
    meetingCount: new Set(
      answer.evidence.map(
        (e: any) =>
          meetings.find((m) => m.segments.some((s) => s.id === e.segmentId))
            ?.id,
      ),
    ).size,
    coverage: answer.coverage,
    seconds: (Date.now() - qaStart) / 1000,
  };
} catch (e) {
  report.qa = {
    status: "failed",
    error: String(e),
    seconds: (Date.now() - qaStart) / 1000,
  };
}
report.finished = new Date().toISOString();
writeFileSync(join(root, "final-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
