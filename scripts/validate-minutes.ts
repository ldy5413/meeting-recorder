/** Explicit real-service validation on an isolated copy of installed meeting data. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Store } from "../electron/store";
import { Services } from "../electron/services";
import { minutesMarkdown, minutesPoints } from "../shared/minutes";
import type { Job, Meeting, Settings } from "../shared/types";

const option = (key: string) =>
  process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const sourceDir =
  option("source") ?? join(process.env.APPDATA!, "meeting-recorder");
const root = resolve(
  option("output") ??
    `.local/minutes-validation/${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
if (
  !root.startsWith(resolve(".local") + "/") &&
  !root.startsWith(resolve(".local") + "\\")
)
  throw new Error("Validation output must stay under .local");
mkdirSync(root, { recursive: true });
const config: Settings = JSON.parse(
  readFileSync(join(sourceDir, "settings.json"), "utf8"),
);
if (!config.consent) throw new Error("Configured analysis consent is required");
if (
  existsSync(join(sourceDir, "key.encrypted")) &&
  !process.env.MEETING_API_KEY
)
  throw new Error(
    "Pass MEETING_API_KEY privately when the configured service needs a key",
  );
const source = new DatabaseSync(join(sourceDir, "library", "library.sqlite"), {
  readOnly: true,
});
const store = new Store(join(root, "library.sqlite"));
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const before = source
  .prepare("SELECT id,data FROM meetings")
  .all()
  .map((row) => ({ id: row.id, hash: digest(row.data as string) }));
const meetings = source
  .prepare("SELECT data FROM meetings")
  .all()
  .map((row) => JSON.parse(row.data as string) as Meeting)
  .filter(
    (m) =>
      m.analyses.at(-1)?.mode === "visual" &&
      (!option("meeting") || m.id === option("meeting")),
  );
for (const table of ["projects", "records"] as const)
  for (const row of source.prepare(`SELECT data FROM ${table}`).all())
    store.put(table, JSON.parse(row.data as string));
for (const row of source
  .prepare("SELECT key,value FROM meta WHERE key LIKE 'template%'")
  .all())
  store.db
    .prepare("INSERT OR REPLACE INTO meta VALUES (?,?)")
    .run(row.key as string, row.value as string);
const service = new Services(
  store,
  join(root, "audio"),
  () => config,
  () => process.env.MEETING_API_KEY ?? "",
);
const report: any = {
  model: config.model,
  meetings: [],
  sourceUnchanged: false,
};
for (const m of meetings) {
  if (!store.db.prepare("SELECT id FROM meetings WHERE id=?").get(m.id))
    store.put("meetings", m);
  const current = store.get<Meeting>("meetings", m.id);
  const a = current.analyses.at(-1)!;
  const pending = store
    .all<Job>("jobs")
    .filter((j) => j.meetingId === m.id && j.kind === "synthesize")
    .at(-1);
  if (!a.minutes?.length || process.argv.includes("--rerun")) {
    const job =
      pending?.status === "failed" && !process.argv.includes("--rerun")
        ? service.retry(pending.id)
        : service.start(m.id, "synthesize", false, a.id);
    const started = Date.now();
    let last = "";
    while (service.controllers.size) {
      const status = store.get<Job>("jobs", job.id);
      if (last !== status.step) {
        last = status.step;
        console.log(JSON.stringify({ meeting: m.title, step: status.step }));
      }
      if (Date.now() - started > 30 * 60 * 1000) {
        await service.cancel(job.id);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const result = store.get<Meeting>("meetings", m.id).analyses.at(-1)!;
  const minutes = result.minutes?.at(-1);
  const job = store
    .all<Job>("jobs")
    .filter((j) => j.meetingId === m.id && j.kind === "synthesize")
    .at(-1);
  const metrics = {
    meeting: m.title,
    id: m.id,
    job: job?.status,
    error: job?.error,
    detailedClaims: a.claims.length,
    detailedCharacters: a.claims.reduce((n, c) => n + c.text.length, 0),
    points: minutes ? minutesPoints(minutes.content).length : 0,
    characters: minutes
      ? minutesPoints(minutes.content).reduce(
          (n, p) => n + p.point.text.length,
          0,
        )
      : 0,
    auditCalls: minutes?.auditIds.length,
  };
  if (minutes)
    writeFileSync(
      join(root, `${m.id}.md`),
      `# ${m.title}\n\n${minutesMarkdown(minutes)}`,
    );
  report.meetings.push(metrics);
  writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(metrics));
}
const after = source
  .prepare("SELECT id,data FROM meetings")
  .all()
  .map((row) => ({ id: row.id, hash: digest(row.data as string) }));
report.sourceUnchanged = JSON.stringify(before) === JSON.stringify(after);
writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({ output: root, sourceUnchanged: report.sourceUnchanged }),
);
source.close();
store.close();
if (report.meetings.some((m: any) => m.job !== "complete"))
  process.exitCode = 1;
