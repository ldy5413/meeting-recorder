import * as tar from "tar";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "./store";
import { z } from "zod";
import {
  Id,
  SegmentSchema,
  ClaimSchema,
  FrameSchema,
  VideoSchema,
  ContextSchema,
  SettingsSchema,
  MeetingMinutesSchema,
} from "../shared/types";
import { ResolvedLanguageSchema } from "../shared/language";
import { validateMinutes } from "../shared/minutes";
export async function backup(
  store: Store,
  library: string,
  destination: string,
) {
  const staging = mkdtempSync(join(dirname(library), "backup-"));
  try {
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    copyFileSync(store.path, join(staging, "library.sqlite"));
    writeFileSync(
      join(staging, "manifest.json"),
      JSON.stringify({
        format: "meeting-recorder",
        version: 3,
        created: new Date().toISOString(),
      }),
    );
    mkdirSync(join(staging, "audio"));
    for (const file of readdirSync(join(library, "audio")))
      if (
        /^[a-f0-9-]{36}(?:-(?:mic|system|speech|capture))?\.(wav|mp3|m4a|mp4|ogg|webm|flac)$/i.test(
          file,
        )
      )
        copyFileSync(
          join(library, "audio", file),
          join(staging, "audio", file),
        );
    mkdirSync(join(staging, "frames"));
    if (existsSync(join(library, "frames")))
      for (const file of readdirSync(join(library, "frames")))
        if (/^[a-f0-9-]{36}\.jpg$/i.test(file))
          copyFileSync(
            join(library, "frames", file),
            join(staging, "frames", file),
          );
    await tar.c({ gzip: true, file: destination, cwd: staging }, [
      "manifest.json",
      "library.sqlite",
      "audio",
      "frames",
    ]);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
export async function stageRestore(archive: string, library: string) {
  const staging = mkdtempSync(join(dirname(library), "restore-"));
  let bytes = 0;
  let invalid = "";
  const seen = new Set<string>();
  try {
    await tar.t({
      file: archive,
      onReadEntry(entry) {
        const p = entry.path.replace(/\/$/, "");
        if (
          !["File", "Directory"].includes(entry.type) ||
          !(
            /^(manifest\.json|library\.sqlite|audio|frames)$/.test(p) ||
            /^frames\/[a-f0-9-]{36}\.jpg$/i.test(p) ||
            /^audio\/[a-f0-9-]{36}(?:-(?:mic|system|speech|capture))?\.(wav|mp3|m4a|mp4|ogg|webm|flac)$/i.test(
              p,
            )
          ) ||
          seen.has(p)
        )
          invalid = "备份包含不安全或重复路径";
        seen.add(p);
        bytes += entry.size;
        if (bytes > 30 * 1024 ** 3) invalid = "备份超过 30 GB 安全上限";
      },
    });
    if (invalid) throw new Error(invalid);
    await tar.x({
      file: archive,
      cwd: staging,
      strict: true,
      noChmod: true,
      noMtime: true,
    });
    const manifest = JSON.parse(
      readFileSync(join(staging, "manifest.json"), "utf8"),
    );
    if (
      manifest.format !== "meeting-recorder" ||
      ![1, 2, 3].includes(manifest.version)
    )
      throw new Error("备份版本不兼容");
    const db = new DatabaseSync(join(staging, "library.sqlite"), {
      readOnly: true,
    });
    try {
      const preferences = db
        .prepare("SELECT value FROM meta WHERE key='languagePreferences'")
        .get();
      if (preferences)
        SettingsSchema.pick({
          uiLanguage: true,
          defaultReportLanguage: true,
        }).parse(JSON.parse(preferences.value as string));
      if (
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type IN ('trigger','view')",
          )
          .all().length
      )
        throw new Error("备份包含非标准数据库对象");
      if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
        throw new Error("备份数据库损坏");
      if (
        db.prepare("SELECT value FROM meta WHERE key='schema'").get()?.value !==
        "1"
      )
        throw new Error("数据库版本不兼容");
      for (const row of db.prepare("SELECT data FROM meetings").all()) {
        const m = z
          .object({
            id: Id,
            title: z.string(),
            projectId: Id.nullable(),
            created: z.string(),
            deletedAt: z.string().datetime().optional(),
            status: z.enum(["empty", "ready", "recording", "interrupted"]),
            audio: z.string().nullable(),
            capture: z
              .object({
                status: z.enum([
                  "recording",
                  "finalizing",
                  "failed",
                  "complete",
                ]),
                sourceName: z.string(),
                bytes: z
                  .number()
                  .int()
                  .min(0)
                  .max(24 * 1024 ** 3),
                nextSeq: z.number().int().min(0),
              })
              .optional(),
            video: VideoSchema.optional(),
            context: ContextSchema.optional(),
            sampleRate: z.number().min(8000).max(96000),
            version: z.number().int().min(0),
            segments: z.array(SegmentSchema),
            speakers: z.record(z.string(), z.string()),
            analyses: z.array(
              z.object({
                language: ResolvedLanguageSchema.optional(),
                id: Id,
                version: z.number().int(),
                created: z.string(),
                raw: z.string(),
                claims: z.array(ClaimSchema),
                minutes: z.array(MeetingMinutesSchema).optional(),
                editedNotes: z.string().nullable(),
                visual: z
                  .object({
                    revision: z.number().int().min(0),
                    frames: z.array(FrameSchema),
                  })
                  .optional(),
              }),
            ),
          })
          .parse(JSON.parse(row.data as string));
        for (const analysis of m.analyses) {
          const ids = new Set<string>();
          for (const minutes of analysis.minutes ?? []) {
            if (minutes.analysisId !== analysis.id || ids.has(minutes.id))
              throw new Error("备份纪要来源或版本标识无效");
            ids.add(minutes.id);
            validateMinutes(minutes.content, analysis.claims.length);
          }
        }
        if (
          m.capture &&
          m.capture.status !== "complete" &&
          !seen.has(`audio/${m.id}-capture.webm`)
        )
          throw new Error("备份缺少待恢复的录像数据");
        if (m.audio) {
          if (
            !/^[a-f0-9-]{36}\.(wav|mp3|m4a|mp4|ogg|webm|flac)$/i.test(
              m.audio,
            ) ||
            !seen.has(`audio/${m.audio}`)
          )
            throw new Error("备份录音缺失或路径无效");
        }
        for (const frame of [
          ...(m.video?.frames ?? []),
          ...m.analyses.flatMap((a) => a.visual?.frames ?? []),
        ])
          if (!seen.has(`frames/${frame.file}`))
            throw new Error("备份画面缺失");
      }
      for (const table of ["projects", "records", "jobs"]) {
        for (const row of db.prepare(`SELECT id,data FROM ${table}`).all()) {
          const value = JSON.parse(row.data as string);
          if (table === "projects" && value.context)
            ContextSchema.parse(value.context);
          if (table === "jobs" && value.language)
            ResolvedLanguageSchema.parse(value.language);
          Id.parse(value.id);
          if (value.id !== row.id) throw new Error("备份记录标识不一致");
        }
      }
    } finally {
      db.close();
    }
    return staging;
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}
export function activateRestore(staging: string, library: string) {
  const previous = `${library}-before-restore-${Date.now()}`;
  renameSync(library, previous);
  try {
    renameSync(staging, library);
  } catch (e) {
    renameSync(previous, library);
    throw e;
  }
  return previous;
}
