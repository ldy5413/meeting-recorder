/** Explicit real-service validation. Private inputs/outputs stay under .local. */
import {
  readdirSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/store";
import { Services } from "../electron/services";
import { importMedia } from "../electron/video";
import { markdown } from "../electron/export";
import type { Meeting, Job, Settings } from "../shared/types";

const baseUrl = process.env.VLLM_BASE_URL;
const model = process.env.VLLM_MODEL;
if (!baseUrl || !model)
  throw new Error("请设置 VLLM_BASE_URL 和 VLLM_MODEL，再显式运行真实录像验证");

const root = resolve(".local/video-validation");
mkdirSync(join(root, "library", "audio"), { recursive: true });
const store = new Store(join(root, "library", "library.sqlite"));
const settings: Settings = {
  asrUrl: "http://127.0.0.1:8765",
  baseUrl,
  model,
  contextBudget: 65536,
  consent: true,
  visualConsent: true,
};
const service = new Services(
  store,
  join(root, "library", "audio"),
  () => settings,
  () => "",
);
const prepareOnly = process.argv.includes("--prepare");
const selectedIndex = Number(
  process.argv.find((arg) => arg.startsWith("--index="))?.split("=")[1] || 0,
);
writeFileSync(join(root, "settings.json"), JSON.stringify(settings, null, 2));
const wait = async (id: string) => {
  let last = "";
  while (service.controllers.has(id)) {
    const job = store.get<Job>("jobs", id);
    if (job.step !== last) {
      console.log(`${job.kind}: ${job.step}`);
      last = job.step;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const job = store.get<Job>("jobs", id);
  if (job.status !== "complete") throw new Error(`${job.kind}: ${job.error}`);
};
try {
  for (const [index, file] of readdirSync(".")
    .filter((f) => f.endsWith(".mp4"))
    .sort()
    .entries()) {
    if (selectedIndex && index + 1 !== selectedIndex) continue;
    let meeting = store
      .all<Meeting>("meetings")
      .find((m) => m.title === file.replace(/\.mp4$/, ""));
    if (!meeting) {
      meeting = store.createMeeting(file.replace(/\.mp4$/, ""), null);
      meeting = await importMedia(
        store,
        service.audioDir,
        meeting.id,
        resolve(file),
      );
    }
    console.log(`Video ${index + 1}: ${meeting.id}`);
    if (
      !meeting.video?.extracted ||
      meeting.video.frames.some(
        (f) => (!f.model || !f.contentType) && !f.excluded,
      )
    ) {
      const previous = store
        .all<Job>("jobs")
        .findLast(
          (j) =>
            j.meetingId === meeting!.id &&
            j.kind === "visuals" &&
            ["failed", "cancelled"].includes(j.status),
        );
      const job = previous
        ? service.retry(previous.id)
        : service.start(meeting.id, "visuals");
      await wait(job.id);
    }
    if (prepareOnly) continue;
    const asrJobs: { source: string; remoteId: string }[] = JSON.parse(
      readFileSync(join(root, "asr-jobs.json"), "utf8"),
    );
    const asrIndex = asrJobs.findIndex(
      (j) => resolve(j.source) === resolve(file),
    );
    if (asrIndex < 0)
      throw new Error("ASR manifest does not contain this source video");
    const resultFile = join(root, `asr-${asrIndex + 1}.json`);
    if (!existsSync(resultFile))
      throw new Error("Run scripts/video-asr-validation.py first");
    const result = JSON.parse(readFileSync(resultFile, "utf8"));
    if (result.id !== asrJobs[asrIndex].remoteId)
      throw new Error("ASR job/source mismatch");
    if (result.status !== "complete")
      throw new Error(`ASR ${index + 1}: ${result.status}`);
    meeting = store.get<Meeting>("meetings", meeting.id);
    if (result.segments.some((s: any) => s.end > meeting!.video!.duration + 1))
      throw new Error("Transcript exceeds source video duration");
    if (!meeting.segments.length) {
      store.saveTranscript(
        meeting.id,
        meeting.version,
        result.segments.map((s: any) => ({ ...s, id: randomUUID() })),
        {},
        JSON.stringify(result),
      );
    }
    for (const useVisuals of [false, true]) {
      meeting = store.get<Meeting>("meetings", meeting.id);
      if (!meeting.analyses.some((a) => !!a.visual === useVisuals)) {
        const previous = store
          .all<Job>("jobs")
          .findLast(
            (j) =>
              j.meetingId === meeting!.id &&
              j.kind === "analyze" &&
              !!j.useVisuals === useVisuals &&
              (!j.visualSnapshot ||
                j.visualSnapshot.revision === meeting!.video?.revision) &&
              ["failed", "cancelled"].includes(j.status),
          );
        const job = previous
          ? service.retry(previous.id)
          : service.start(meeting.id, "analyze", useVisuals);
        await wait(job.id);
      }
    }
    meeting = store.get<Meeting>("meetings", meeting.id);
    for (const analysis of meeting.analyses)
      writeFileSync(
        join(root, `${index + 1}-${analysis.visual ? "visual" : "audio"}.md`),
        markdown(meeting, analysis.id, "library/frames"),
      );
  }
} finally {
  const report = store.all<Meeting>("meetings").map((m) => ({
    id: m.id,
    duration: m.video?.duration,
    frames: m.video?.frames.length,
    recognized: m.video?.frames.filter((f) => f.model).length,
    activeFrames: m.video?.frames.filter((f) => !f.excluded && f.text).length,
    excludedFrames: m.video?.frames.filter((f) => f.excluded).length,
    segments: m.segments.length,
    analyses: m.analyses.map((a) => ({
      id: a.id,
      mode: a.mode,
      claims: a.claims.length,
      visualClaims: a.claims.filter((c) => c.evidence.some((e) => e.frameId))
        .length,
      citedFrames: new Set(
        a.claims.flatMap((c) =>
          c.evidence.flatMap((e) => (e.frameId ? [e.frameId] : [])),
        ),
      ).size,
    })),
  }));
  writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2));
  store.close();
}
