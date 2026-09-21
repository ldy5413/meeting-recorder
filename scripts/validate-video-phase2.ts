/** Explicit internal-service comparison in an isolated library; never runs in CI. */
import {
  existsSync,
  mkdirSync,
  linkSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../electron/store";
import { Services } from "../electron/services";
import { markdown } from "../electron/export";
import type { Job, Meeting, Settings } from "../shared/types";
import { readFileSync } from "node:fs";

const baseline = resolve(".local/video-validation");
const root = resolve(".local/video-phase2");
const index = Number(
  process.argv.find((s) => s.startsWith("--index="))?.split("=")[1] || 1,
);
for (const folder of ["audio", "frames"])
  mkdirSync(join(root, "library", folder), { recursive: true });
const source = new Store(join(baseline, "library", "library.sqlite"));
const store = new Store(join(root, "library", "library.sqlite"));
const settings: Settings = JSON.parse(
  readFileSync(join(baseline, "settings.json"), "utf8"),
);
writeFileSync(join(root, "settings.json"), JSON.stringify(settings));
const service = new Services(
  store,
  join(root, "library", "audio"),
  () => settings,
  () => "",
);
const initial = source
  .all<Meeting>("meetings")
  .sort((a, b) => a.title.localeCompare(b.title, "en"))[index - 1];
if (!initial) throw new Error("Video index is not available");
const mirror = (folder: string, file: string) => {
  const from = join(baseline, "library", folder, file),
    to = join(root, "library", folder, file);
  if (!existsSync(to)) {
    try {
      linkSync(from, to);
    } catch {
      copyFileSync(from, to);
    }
  }
};
try {
  if (!store.all<Meeting>("meetings").some((m) => m.id === initial.id)) {
    mirror("audio", initial.audio!);
    initial.video!.frames.forEach((f) => mirror("frames", f.file));
    const copy = structuredClone(initial);
    copy.analyses = [];
    store.put("meetings", copy);
  }
  let meeting = store.get<Meeting>("meetings", initial.id);
  if (!meeting.analyses.length || process.argv.includes("--rerun")) {
    const previous = store
      .all<Job>("jobs")
      .findLast(
        (j) =>
          j.meetingId === meeting.id &&
          j.kind === "analyze" &&
          j.status === "failed",
      );
    const job = previous
      ? service.retry(previous.id)
      : service.start(meeting.id, "analyze", true);
    let last = "";
    while (service.controllers.size) {
      const current = store.get<Job>("jobs", job.id);
      if (last !== current.step) {
        last = current.step;
        console.log(`Video ${index}: ${last}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    const result = store.get<Job>("jobs", job.id);
    if (result.status !== "complete")
      throw new Error(result.error || result.status);
  }
  meeting = store.get<Meeting>("meetings", meeting.id);
  const analysis = meeting.analyses.at(-1)!;
  const jobMetrics = (library: Store) => {
    const job = library
      .all<Job>("jobs")
      .filter(
        (j) =>
          j.meetingId === meeting.id &&
          j.kind === "analyze" &&
          j.useVisuals &&
          j.status === "complete",
      )
      .sort((a, b) => a.created.localeCompare(b.created))
      .at(-1);
    const groups = job?.checkpoint?.map((raw) => JSON.parse(raw)) ?? [];
    const reused =
      job &&
      library.db
        .prepare("SELECT value FROM meta WHERE key=?")
        .get(`phase2-replay-source:${job.id}`)?.value;
    const reusedSpeechGroups = reused
      ? (JSON.parse(String(reused)).speechGroups as number)
      : 0;
    const executed = groups.slice(reusedSpeechGroups);
    return {
      jobId: job?.id,
      groups: groups.length,
      reusedSpeechGroups,
      generationCalls: executed.length,
      semanticReviewCalls: executed.filter(
        (g) => JSON.parse(g.verificationRaw).source !== "empty-proposal",
      ).length,
      duplicateVerdicts: groups
        .flatMap((g) => JSON.parse(g.verificationRaw).reviews ?? [])
        .filter((r) => r.novel === false).length,
      note: "Counts cover newly executed completed extraction/review groups; exclude reused speech groups, observation, organization, failed attempts and schema-feedback retries.",
    };
  };
  writeFileSync(
    join(root, `video-${index}.md`),
    markdown(meeting, analysis.id, "library/frames"),
  );
  writeFileSync(
    join(root, `report-${index}.json`),
    JSON.stringify(
      {
        meetingId: meeting.id,
        title: meeting.title,
        baselineClaims: initial.analyses.filter((a) => a.visual).at(-1)?.claims
          .length,
        claims: analysis.claims.length,
        visualClaims: analysis.claims.filter((c) =>
          c.evidence.some((e) => e.frameId),
        ).length,
        parameterClaims: analysis.claims.filter((c) => c.parameterRefs?.length)
          .length,
        citedFrames: new Set(
          analysis.claims.flatMap((c) =>
            c.evidence.map((e) => e.frameId).filter(Boolean),
          ),
        ).size,
        baselineRequests: jobMetrics(source),
        phase2Requests: jobMetrics(store),
        analysisId: analysis.id,
      },
      null,
      2,
    ),
  );
  console.log(`Video ${index}: completed`);
} finally {
  source.close();
  store.close();
}
