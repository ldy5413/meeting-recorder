import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkEvidence, validateClaims } from "../electron/store";
import type { State, Meeting, Job } from "../shared/types";
import { request as httpRequest } from "node:http";

const ids = process.argv.slice(2);
if (ids.length !== 2 || new Set(ids).size !== 2)
  throw new Error(
    "用法: npx tsx scripts/validate-live-meetings.ts <会议ID1> <会议ID2>",
  );
const manifest = join(
  process.env.LOCALAPPDATA!,
  "MeetingRecorder-dev-browser/dev-bridge.json",
);
const root = resolve(
  ".local/live-vibevoice-validation",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
mkdirSync(root, { recursive: true });
async function request(input: unknown) {
  const { origin, token } = JSON.parse(readFileSync(manifest, "utf8"));
  const result: any = await new Promise((resolve, reject) => {
    const req = httpRequest(
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
            if (res.statusCode !== 200)
              throw new Error(`bridge HTTP ${res.statusCode}`);
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(900000, () =>
      req.destroy(new Error("bridge request exceeded 900 seconds")),
    );
    req.on("error", reject);
    req.end(JSON.stringify(input));
  });
  if (!result.ok) throw new Error(result.error ?? "bridge request failed");
  return result.value;
}
const report: any = {
  source:
    "actual VibeVoice transcription of the two user-authorized recordings",
  started: new Date().toISOString(),
  meetings: [],
};
const save = () =>
  writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2));
let last = "",
  state: State;
// Read only while ASR is active. Never start, retry, cancel or alter transcription jobs.
while (true) {
  try {
    state = await request({ op: "state" });
    const progress = ids.map((id) => {
      const m = state.meetings.find((m) => m.id === id)!;
      const jobs = state.jobs
        .filter((j) => j.meetingId === id && j.kind === "transcribe")
        .sort((a, b) => b.created.localeCompare(a.created));
      return {
        id,
        version: m.version,
        segments: m.segments.length,
        status: jobs[0]?.status,
        step: jobs[0]?.step,
        error: jobs[0]?.error,
      };
    });
    const line = JSON.stringify(progress);
    if (line !== last) {
      last = line;
      console.log(line);
      report.asr = progress;
      save();
    }
    if (progress.some((p) => p.status === "complete" && p.segments > 0)) break;
  } catch (e) {
    console.log(JSON.stringify({ waitingForBridge: String(e) }));
  }
  await new Promise((r) => setTimeout(r, 15000));
}
const project =
  state!.projects.find((p) => p.name === "VibeVoice真实录音验收") ??
  (await request({
    op: "project.create",
    name: "VibeVoice真实录音验收",
  }));
const analysisOrder = [...ids].sort(
  (a, b) =>
    state!.meetings.find((m) => m.id === b)!.segments.length -
    state!.meetings.find((m) => m.id === a)!.segments.length,
);
report.projectId = project.id;
report.model = state!.settings.model;
report.baseUrl = state!.settings.baseUrl;
report.contextBudget = state!.settings.contextBudget;
for (const id of analysisOrder) {
  let waiting = "";
  while (true) {
    try {
      state = await request({ op: "state" });
      const m = state.meetings.find((m) => m.id === id)!;
      const asr = state.jobs
        .filter((j) => j.meetingId === id && j.kind === "transcribe")
        .sort((a, b) => b.created.localeCompare(a.created))[0];
      const line = JSON.stringify({
        id,
        status: asr?.status,
        step: asr?.step,
        error: asr?.error,
        segments: m.segments.length,
      });
      if (line !== waiting) {
        waiting = line;
        console.log(line);
      }
      if (asr?.status === "complete" && m.segments.length) break;
    } catch (e) {
      console.log(JSON.stringify({ waitingForBridge: String(e) }));
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  const readyMeeting = state!.meetings.find((m) => m.id === id)!;
  await request({
    op: "meeting.update",
    id,
    title: readyMeeting.title,
    projectId: project.id,
  });
  const started = Date.now();
  const job: Job = await request({ op: "job.start", id, kind: "analyze" });
  let step = "",
    current: Job;
  while (true) {
    state = await request({ op: "state" });
    current = state.jobs.find((j) => j.id === job.id)!;
    if (current.step !== step) {
      step = current.step;
      console.log(
        JSON.stringify({
          id,
          status: current.status,
          step,
          error: current.error,
          elapsedSeconds: (Date.now() - started) / 1000,
        }),
      );
    }
    if (!["queued", "running"].includes(current.status)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const m = state.meetings.find((m) => m.id === id)!,
    analysis = m.analyses.at(-1);
  if (analysis)
    validateClaims(
      analysis.claims,
      m.segments,
      state.records.filter((r) => r.projectId === project.id),
    );
  const checkpoints = (current.checkpoint ?? []).map((raw) => JSON.parse(raw));
  const metrics = {
    id,
    segments: m.segments.length,
    endSeconds: m.segments.at(-1)?.end,
    status: current.status,
    error: current.error,
    elapsedSeconds: (Date.now() - started) / 1000,
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
  };
  report.meetings.push(metrics);
  writeFileSync(
    join(root, `${id}.json`),
    JSON.stringify({ meeting: m, job: current }, null, 2),
  );
  save();
  console.log(JSON.stringify(metrics));
}
const started = Date.now();
try {
  const answer = await request({
    op: "ask",
    question: "这两场会议讨论了哪些待办和决定？请只回答有原文依据的内容。",
    projectId: project.id,
    meetingId: null,
    from: "",
    to: "",
  });
  state = await request({ op: "state" });
  const meetings = state.meetings.filter((m) => ids.includes(m.id));
  checkEvidence(
    answer.evidence,
    meetings.flatMap((m) => m.segments),
  );
  writeFileSync(join(root, "answer.json"), JSON.stringify(answer, null, 2));
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
    elapsedSeconds: (Date.now() - started) / 1000,
  };
} catch (e) {
  report.qa = {
    status: "failed",
    error: String(e),
    elapsedSeconds: (Date.now() - started) / 1000,
  };
}
report.finished = new Date().toISOString();
save();
console.log(JSON.stringify({ root, ...report }));
