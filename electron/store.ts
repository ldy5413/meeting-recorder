import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { builtinTemplates, contextOf } from "../shared/analysis";
import { frameEvidenceText } from "../shared/visual";
import { isAnonymousSpeakerLabel } from "../shared/speakers";
import type {
  AnalysisTemplate,
  MeetingContext,
  AnalysisSnapshot,
  Settings,
} from "../shared/types";
import {
  SegmentSchema,
  type Meeting,
  type Project,
  type Job,
  type RecordItem,
  type Claim,
  type Evidence,
  type VisualFrame,
  type VisualParameter,
} from "../shared/types";
function calendarDate(value: string) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function checkEvidence(
  evidence: Evidence[],
  segments: Iterable<{ id: string; text: string }>,
  frames: Iterable<{
    id: string;
    text: string;
    parameters?: VisualParameter[];
  }> = [],
) {
  const byId = new Map(Array.from(segments, (s) => [s.id, s.text]));
  const byFrame = new Map(
    Array.from(frames, (f) => [f.id, frameEvidenceText(f)]),
  );
  for (const e of evidence)
    if (
      !(e.frameId ? byFrame.get(e.frameId) : byId.get(e.segmentId!))?.includes(
        e.quote,
      )
    )
      throw new Error("模型引用不存在或引文与原文不一致");
}
export class Store {
  db: DatabaseSync;
  constructor(
    public path: string,
    private preferences: () => Pick<
      Settings,
      "defaultReportLanguage"
    > = () => ({}),
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS meetings(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS versions(meeting_id TEXT,version INTEGER,data TEXT NOT NULL,raw TEXT,PRIMARY KEY(meeting_id,version));
   CREATE TABLE IF NOT EXISTS accepted(key TEXT PRIMARY KEY);
   CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(id UNINDEXED,meeting_id UNINDEXED,text,tokenize='trigram');`);
    this.db
      .prepare("INSERT OR IGNORE INTO meta VALUES (?,?)")
      .run("schema", "1");
  }
  all<T>(table: "meetings" | "projects" | "jobs" | "records"): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table}`)
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
  get<T>(table: "meetings" | "projects" | "jobs" | "records", id: string): T {
    const r = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    if (!r) throw new Error("记录不存在");
    return JSON.parse(r.data as string);
  }
  put(
    table: "meetings" | "projects" | "jobs" | "records",
    value: { id: string },
  ) {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(value.id, JSON.stringify(value));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  createProject(name: string) {
    const p = {
      id: randomUUID(),
      name,
      context: contextOf({
        reportLanguage: this.preferences().defaultReportLanguage ?? "auto",
      }),
    };
    this.put("projects", p);
    return p;
  }
  createMeeting(title: string, projectId: string | null, occurredAt?: string) {
    if (projectId) this.get<Project>("projects", projectId);
    const m: Meeting = {
      id: randomUUID(),
      title,
      projectId,
      created: new Date().toISOString(),
      occurredAt: occurredAt ?? new Date().toISOString(),
      status: "empty",
      audio: null,
      sampleRate: 48000,
      version: 0,
      segments: [],
      speakers: {},
      analyses: [],
      context: contextOf(
        projectId
          ? this.get<Project>("projects", projectId).context
          : {
              reportLanguage:
                this.preferences().defaultReportLanguage ?? "auto",
            },
      ),
    };
    this.put("meetings", m);
    return m;
  }
  templates(): AnalysisTemplate[] {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key='analysisTemplates'")
      .get();
    return [
      ...builtinTemplates,
      ...(row ? JSON.parse(row.value as string) : []),
    ];
  }
  activeMeeting(id: string) {
    const meeting = this.get<Meeting>("meetings", id);
    if (meeting.deletedAt) throw new Error("会议已删除，请先从最近删除中恢复");
    return meeting;
  }
  deleteMeeting(id: string) {
    const meeting = this.get<Meeting>("meetings", id);
    if (
      meeting.status === "recording" ||
      ["recording", "finalizing"].includes(meeting.capture?.status ?? "") ||
      this.all<Job>("jobs").some(
        (job) =>
          job.meetingId === id && ["queued", "running"].includes(job.status),
      )
    )
      throw new Error("请先结束此会议的录制和后台任务，再删除会议");
    meeting.deletedAt ??= new Date().toISOString();
    // Keep source versions and media addressable by confirmed project records.
    this.put("meetings", meeting);
    return meeting;
  }
  restoreMeeting(id: string) {
    const meeting = this.get<Meeting>("meetings", id);
    delete meeting.deletedAt;
    this.put("meetings", meeting);
    return meeting;
  }
  saveTemplate(name: string, requirements: string, id?: string) {
    const templates = this.templates().filter((t) => !t.builtin);
    if (id && !templates.some((t) => t.id === id))
      throw new Error("自定义模板不存在");
    const template = { id: id ?? randomUUID(), name, requirements };
    this.db
      .prepare("INSERT OR REPLACE INTO meta VALUES (?,?)")
      .run(
        "analysisTemplates",
        JSON.stringify([...templates.filter((t) => t.id !== id), template]),
      );
    return template;
  }
  deleteTemplate(id: string) {
    if (!this.templates().some((t) => t.id === id && !t.builtin))
      throw new Error("自定义模板不存在");
    this.db
      .prepare("INSERT OR REPLACE INTO meta VALUES (?,?)")
      .run(
        "analysisTemplates",
        JSON.stringify(
          this.templates().filter((t) => !t.builtin && t.id !== id),
        ),
      );
  }
  configure(
    table: "meetings" | "projects",
    id: string,
    context: MeetingContext,
  ) {
    if (table === "meetings") this.activeMeeting(id);
    if (!this.templates().some((t) => t.id === context.templateId))
      throw new Error("模板已删除，请重新选择");
    const value = this.get<Meeting | Project>(table, id);
    value.context = contextOf(context);
    this.put(table, value);
    return value;
  }
  reloadDefaults(id: string) {
    const m = this.get<Meeting>("meetings", id);
    return this.configure(
      "meetings",
      id,
      contextOf(
        m.projectId
          ? this.get<Project>("projects", m.projectId).context
          : {
              reportLanguage:
                this.preferences().defaultReportLanguage ?? "auto",
            },
      ),
    );
  }
  snapshot(m: Meeting): AnalysisSnapshot {
    const context = contextOf(m.context);
    const template = this.templates().find((t) => t.id === context.templateId);
    if (!template) throw new Error("模板已删除，请重新选择");
    return structuredClone({
      ...context,
      template,
      speakers: m.speakers,
      records: this.all<RecordItem>("records").filter(
        (r) => r.projectId === m.projectId,
      ),
    });
  }
  saveTranscript(
    id: string,
    version: number,
    segments: Meeting["segments"],
    speakers: Meeting["speakers"],
    raw?: string,
  ) {
    this.activeMeeting(id);
    z.array(SegmentSchema).parse(segments);
    if (new Set(segments.map((s) => s.id)).size !== segments.length)
      throw new Error("片段 ID 重复");
    const m = this.get<Meeting>("meetings", id);
    if (m.version !== version) throw new Error("转录已更新，请刷新后重试");
    // IDs are globally unique and immutable across human edits; old versions remain addressable.
    const foreign = new Set(
      this.all<Meeting>("meetings")
        .filter((x) => x.id !== id)
        .flatMap((x) => x.segments.map((s) => s.id)),
    );
    if (segments.some((s) => foreign.has(s.id)))
      throw new Error("片段 ID 与其他会议冲突");
    return this.transaction(() => {
      m.version++;
      m.segments = segments;
      m.speakers = speakers;
      this.db
        .prepare("INSERT INTO versions VALUES (?,?,?,?)")
        .run(
          id,
          m.version,
          JSON.stringify({ segments, speakers }),
          raw ?? null,
        );
      this.db.prepare("DELETE FROM segments_fts WHERE meeting_id=?").run(id);
      const insert = this.db.prepare("INSERT INTO segments_fts VALUES (?,?,?)");
      for (const s of segments) insert.run(s.id, id, s.text);
      this.put("meetings", m);
      return m;
    });
  }
  recover() {
    for (const m of this.all<Meeting>("meetings"))
      if (m.status === "recording") {
        m.status = "interrupted";
        this.put("meetings", m);
      }
    for (const j of this.all<Job>("jobs"))
      if (j.status === "running" || j.status === "queued") {
        j.status = "failed";
        j.error = "程序中断；可以从已完成步骤重试";
        this.put("jobs", j);
      }
  }
  accept(id: string, analysisId: string, index: number) {
    this.activeMeeting(id);
    return this.transaction(() => {
      const m = this.get<Meeting>("meetings", id),
        a = m.analyses.find((a) => a.id === analysisId),
        c = a?.claims[index];
      if (!a || !c || !["todo", "decision"].includes(c.kind) || !m.projectId)
        throw new Error("请先归入项目并选择待办或决策");
      if (a.version !== m.version) throw new Error("分析已过期，请重新生成");
      if (a.visual && a.visual.revision !== m.video?.revision)
        throw new Error("画面选择已改变，请重新分析");
      validateClaims(
        [c],
        m.segments,
        this.all<RecordItem>("records"),
        m.speakers,
        a.visual?.frames,
      );
      const key = `${analysisId}:${index}`;
      if (this.db.prepare("SELECT key FROM accepted WHERE key=?").get(key))
        throw new Error("此建议已确认");
      let r: RecordItem;
      if (c.targetId) {
        r = this.get<RecordItem>("records", c.targetId);
        if (r.projectId !== m.projectId || r.kind !== c.kind)
          throw new Error("目标记录不属于此项目或类型不符");
        if (a.recordVersions && a.recordVersions[r.id] !== r.version)
          throw new Error("项目记录已被其他会议更新，请重新分析");
        if (c.change === "new") throw new Error("新增建议不能指向已有记录");
        if (c.change === "complete" && r.kind !== "todo")
          throw new Error("只有待办可以完成");
        r.text = c.text;
        r.owner = c.owner;
        r.due = c.due;
        r.status =
          c.change === "complete"
            ? "complete"
            : c.change === "replace"
              ? "replaced"
              : r.status;
        r.evidence = c.evidence;
        r.version++;
      } else {
        if (c.change !== "new") throw new Error("更新建议缺少目标记录");
        const duplicate = this.all<RecordItem>("records").find(
          (r) =>
            r.projectId === m.projectId &&
            r.kind === c.kind &&
            r.text.replace(/\s/g, "") === c.text.replace(/\s/g, ""),
        );
        if (duplicate) throw new Error("已有相同记录，请重新分析生成更新建议");
        r = {
          id: randomUUID(),
          projectId: m.projectId,
          meetingId: id,
          kind: c.kind as "todo" | "decision",
          text: c.text,
          owner: c.owner,
          due: c.due,
          status: "open",
          evidence: c.evidence,
          version: 1,
          history: [],
        };
      }
      r.history.push({
        at: new Date().toISOString(),
        meetingId: id,
        change: c.change,
        evidence: c.evidence,
        text: c.text,
      });
      this.put("records", r);
      this.db.prepare("INSERT INTO accepted VALUES (?)").run(key);
      a.acceptedIndices = [...(a.acceptedIndices ?? []), index];
      this.put("meetings", m);
      return r;
    });
  }
  resolveEvidence(evidence: Evidence) {
    if (evidence.frameId) {
      for (const m of this.all<Meeting>("meetings")) {
        const frame = [
          ...(m.video?.frames ?? []),
          ...m.analyses.flatMap((a) => a.visual?.frames ?? []),
        ].find(
          (f) =>
            f.id === evidence.frameId &&
            frameEvidenceText(f).includes(evidence.quote),
        );
        if (frame) return { meetingId: m.id, frame };
      }
      throw new Error("画面引用不存在或与观察记录不一致");
    }
    for (const m of this.all<Meeting>("meetings")) {
      const current = m.segments.find(
        (s) => s.id === evidence.segmentId && s.text.includes(evidence.quote),
      );
      if (current)
        return { meetingId: m.id, version: m.version, segment: current };
    }
    for (const row of this.db
      .prepare(
        "SELECT meeting_id,version,data FROM versions ORDER BY version DESC",
      )
      .all()) {
      const data = JSON.parse(row.data as string);
      const segment = (data.segments as Meeting["segments"]).find(
        (s) => s.id === evidence.segmentId && s.text.includes(evidence.quote),
      );
      if (segment)
        return {
          meetingId: row.meeting_id as string,
          version: row.version as number,
          segment,
        };
    }
    throw new Error("引用与当前或历史转录均不匹配");
  }
  search(
    question: string,
    projectId: string | null,
    meetingId: string | null,
    from: string,
    to: string,
  ) {
    const meetings = this.all<Meeting>("meetings").filter(
      (m) =>
        !m.deletedAt &&
        (!projectId || m.projectId === projectId) &&
        (!meetingId || m.id === meetingId) &&
        (!from || calendarDate(m.occurredAt ?? m.created) >= from) &&
        (!to || calendarDate(m.occurredAt ?? m.created) <= to),
    );
    const tokens = (
      question.toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]/gu) ?? []
    ).filter((t) => !["的", "了", "吗", "是", "和", "有哪些"].includes(t));
    const words = [...new Set(tokens)];
    const historical = /历史|综述|总结|变化|进展|history|summary/i.test(
      question,
    );
    const matched = new Set<string>();
    // FTS5 trigram accelerates longer terms; LIKE also handles short Chinese words.
    const lookup = this.db.prepare(
      "SELECT id FROM segments_fts WHERE text LIKE ? ESCAPE '\\'",
    );
    for (const word of words.slice(0, 64))
      for (const row of lookup.all(`%${word.replace(/[\\%_]/g, "\\$&")}%`))
        matched.add(row.id as string);
    const related = this.all<RecordItem>("records").filter(
      (r) =>
        (!projectId || r.projectId === projectId) &&
        words.some((w) => r.text.toLowerCase().includes(w)),
    );
    for (const r of related)
      for (const e of r.evidence) if (e.segmentId) matched.add(e.segmentId);
    const ranked = meetings.flatMap((m) =>
      m.segments
        .filter((s) => historical || matched.has(s.id))
        .map((s) => ({
          ...s,
          meetingId: m.id,
          title: m.title,
          date: m.occurredAt ?? m.created,
          score:
            words.reduce(
              (n, t) => n + (s.text.toLowerCase().includes(t) ? 1 : 0),
              0,
            ) + (matched.has(s.id) ? 1 : 0),
        })),
    );
    return (historical ? ranked : ranked.filter((s) => s.score > 0)).sort(
      (a, b) =>
        historical
          ? a.date.localeCompare(b.date)
          : b.score - a.score || a.date.localeCompare(b.date),
    );
  }
  close() {
    this.db.close();
  }
}

export function validateClaims(
  claims: Claim[],
  segments: Meeting["segments"],
  records: RecordItem[],
  speakers: Record<string, string> = {},
  frames: VisualFrame[] = [],
) {
  for (const c of claims) {
    checkEvidence(c.evidence, segments, frames);
    if (c.owner && isAnonymousSpeakerLabel(c.owner))
      throw new Error(
        `负责人 ${c.owner} 是匿名说话人标签，不能作为已确认姓名；owner 应为 null，保留发言引用供核对`,
      );
    for (const ref of c.parameterRefs ?? []) {
      const frame = frames.find((f) => f.id === ref.frameId);
      if (
        !frame?.parameters?.[ref.index] ||
        !c.evidence.some((e) => e.frameId === ref.frameId)
      )
        throw new Error("参数引用不存在或缺少对应画面证据");
    }
    if (
      new Set(c.evidence.flatMap((e) => (e.frameId ? [e.frameId] : []))).size >
      2
    )
      throw new Error("每条最多引用两张画面");
    const speech = c.evidence.filter((e) => e.segmentId);
    if (
      !speech.length &&
      (c.kind === "decision" ||
        c.kind === "todo" ||
        c.owner ||
        c.due ||
        c.change !== "new")
    )
      throw new Error(
        "仅有画面不能确认决策、待办、负责人、期限或完成状态；需要明确发言证据",
      );
    const quotes = speech.map((e) => e.quote).join("\n");
    const mappedSelf =
      c.owner &&
      c.evidence.some((e) => {
        const segment = segments.find((s) => s.id === e.segmentId);
        return (
          segment &&
          speakers[segment.speaker] === c.owner &&
          /我|\bI\b/.test(segment.text)
        );
      });
    if (c.owner && !quotes.includes(c.owner) && !mappedSelf)
      throw new Error(
        `负责人 ${c.owner} 缺少归属依据：${c.text}。负责人必须直接出现在引用原文中，或来自该片段的人工姓名映射且原片段包含我/I与本人承担任务的完整连续原文。引文应保留第一人称主语及行动，不能确认则 owner=null。`,
      );
    if (c.due && !quotes.includes(c.due))
      throw new Error("期限必须直接出现在引用原文中（保留原话）");
    if (
      c.targetId &&
      !records.some((r) => r.id === c.targetId && r.kind === c.kind)
    )
      throw new Error("无效的更新目标");
    if ((c.change === "new") !== !c.targetId)
      throw new Error("更新动作与目标不一致");
  }
}
