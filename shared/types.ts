import { z } from "zod";
import type { Message } from "./messages";
import {
  UiLanguageSchema,
  ReportLanguageSchema,
  ResolvedLanguageSchema,
  type ResolvedLanguage,
} from "./language";
export const Id = z.string().uuid();
export const SegmentSchema = z
  .object({
    id: Id,
    start: z.number().finite().min(0),
    end: z.number().finite().min(0),
    speaker: z.string().min(1).max(100),
    text: z.string().max(20000),
    needsReview: z.boolean().optional(),
  })
  .refine((s) => s.end >= s.start, "结束时间早于开始时间");
export type Segment = z.infer<typeof SegmentSchema>;
export const EvidenceSchema = z.union([
  z.object({
    segmentId: Id,
    frameId: z.never().optional(),
    quote: z.string().min(1).max(2000),
  }),
  z.object({
    frameId: Id,
    segmentId: z.never().optional(),
    quote: z.string().min(1).max(2000),
  }),
]);
export type Evidence = z.infer<typeof EvidenceSchema>;
export const VisualParameterSchema = z.object({
  object: z.string().min(1).max(200),
  metric: z.string().min(1).max(200),
  value: z.string().min(1).max(200),
  unit: z.string().max(100),
  conditions: z.array(z.string().min(1).max(300)).max(12),
});
export type VisualParameter = z.infer<typeof VisualParameterSchema>;
export const FrameSchema = z
  .object({
    id: Id,
    file: z.string().regex(/^[a-f0-9-]{36}\.jpg$/i),
    start: z.number().finite().min(0),
    end: z.number().finite().min(0),
    title: z.string().max(200),
    text: z.string().max(12000),
    uncertain: z.string().max(2000),
    excluded: z.boolean(),
    model: z.string().optional(),
    contentType: z.enum(["content", "participants", "blank"]).optional(),
    parameters: z.array(VisualParameterSchema).max(128).optional(),
    imageHash: z.string().optional(),
    needsRecognition: z.boolean().optional(),
    observationSource: z
      .object({
        baseUrl: z.string(),
        model: z.string(),
        thinkingMode: z.enum(["disabled", "enabled"]).optional(),
      })
      .optional(),
  })
  .refine((f) => f.end >= f.start, "画面结束时间无效");
export type VisualFrame = z.infer<typeof FrameSchema>;
export const VideoSchema = z.object({
  duration: z.number().finite().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  hasAudio: z.boolean(),
  revision: z.number().int().min(0),
  extracted: z.boolean(),
  frames: z.array(FrameSchema).max(1000),
});
export type Video = z.infer<typeof VideoSchema>;
export const ClaimSchema = z.object({
  kind: z.enum(["summary", "topic", "decision", "suggestion", "todo"]),
  text: z.string().min(1).max(8000),
  owner: z.string().max(200).nullable(),
  due: z.string().max(200).nullable(),
  evidence: z.array(EvidenceSchema).min(1),
  targetId: Id.nullable(),
  change: z.enum(["new", "continue", "complete", "replace"]),
  parameterRefs: z
    .array(z.object({ frameId: Id, index: z.number().int().min(0) }))
    .max(32)
    .optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;
export const ContextSchema = z.object({
  transcriptionLanguage: z.enum(["zh", "en"]).optional(),
  reportLanguage: ReportLanguageSchema.optional(),
  background: z.string().max(30000).default(""),
  keywords: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  templateId: z.string().min(1).max(100).default("project-progress"),
  additionalRequirements: z.string().max(10000).default(""),
});
export type MeetingContext = z.infer<typeof ContextSchema>;
export interface AnalysisTemplate {
  id: string;
  name: string;
  requirements: string;
  builtin?: boolean;
}
export interface AnalysisSection {
  title: string;
  claimIndices: number[];
  children: AnalysisSection[];
}
export interface AnalysisSnapshot extends MeetingContext {
  template: AnalysisTemplate;
  speakers: Record<string, string>;
  records: RecordItem[];
}
export interface Analysis {
  minutes?: MeetingMinutes[];
  language?: ResolvedLanguage;
  visual?: { revision: number; frames: VisualFrame[] };
  mode?: "audio" | "visual";
  snapshot?: AnalysisSnapshot;
  sections?: AnalysisSection[];
  id: string;
  version: number;
  created: string;
  raw: string;
  claims: Claim[];
  editedNotes: string | null;
  recordVersions?: Record<string, number>;
  acceptedIndices?: number[];
}
export const MinutesPointSchema = z.object({
  text: z.string().trim().min(1).max(1200),
  sourceIndices: z.array(z.number().int().nonnegative()).min(1).max(1000),
});
export type MinutesPoint = z.infer<typeof MinutesPointSchema>;
export interface MinutesSection {
  title: string;
  items: MinutesPoint[];
  children: MinutesSection[];
}
export const MinutesSectionSchema: z.ZodType<MinutesSection> = z.lazy(() =>
  z.object({
    title: z.string().trim().min(1).max(160),
    items: z.array(MinutesPointSchema).max(30),
    children: z.array(MinutesSectionSchema).max(30),
  }),
);
export const MinutesContentSchema = z.object({
  overview: z.array(MinutesPointSchema).max(3),
  sections: z.array(MinutesSectionSchema).max(30),
});
export type MinutesContent = z.infer<typeof MinutesContentSchema>;
export interface MeetingMinutes {
  id: string;
  analysisId: string;
  jobId: string;
  created: string;
  language: ResolvedLanguage;
  template: AnalysisTemplate;
  additionalRequirements: string;
  content: MinutesContent;
  auditIds: string[];
}
export const MeetingMinutesSchema = z.object({
  id: Id,
  analysisId: Id,
  jobId: Id,
  created: z.string(),
  language: ResolvedLanguageSchema,
  template: z.object({
    id: z.string().min(1),
    name: z.string(),
    requirements: z.string(),
    builtin: z.boolean().optional(),
  }),
  additionalRequirements: z.string(),
  content: MinutesContentSchema,
  auditIds: z.array(z.string()),
});
export interface Meeting {
  deletedAt?: string;
  capture?: ScreenCapture;
  video?: Video;
  mediaType?: "audio" | "video";
  context?: MeetingContext;
  id: string;
  title: string;
  projectId: string | null;
  created: string;
  occurredAt?: string;
  status: "empty" | "recording" | "interrupted" | "ready";
  audio: string | null;
  sampleRate: number;
  version: number;
  segments: Segment[];
  speakers: Record<string, string>;
  analyses: Analysis[];
}
export interface Project {
  context?: MeetingContext;
  id: string;
  name: string;
}
export interface RecordItem {
  id: string;
  projectId: string;
  meetingId: string;
  kind: "todo" | "decision";
  text: string;
  owner: string | null;
  due: string | null;
  status: "open" | "complete" | "replaced";
  evidence: Evidence[];
  version: number;
  history: {
    at: string;
    meetingId: string;
    change: string;
    evidence: Evidence[];
    text: string;
  }[];
}
export interface Job {
  transcription?: { mode: "local" | "remote"; language: "zh" | "en" };
  language?: ResolvedLanguage;
  stepMessage?: Message;
  errorMessage?: Message;
  snapshot?: AnalysisSnapshot;
  id: string;
  meetingId: string;
  kind: "transcribe" | "analyze" | "speakers" | "visuals" | "synthesize";
  sourceAnalysisId?: string;
  autoSynthesize?: boolean;
  expectedSpeakers?: number;
  completedAnalysisId?: string;
  useVisuals?: boolean;
  visualSnapshot?: { revision: number; frames: VisualFrame[] };
  visualConfig?: { baseUrl: string; model: string };
  status: "queued" | "running" | "failed" | "complete" | "cancelled";
  step: string;
  error: string | null;
  remoteId: string | null;
  remoteUrl?: string;
  version: number;
  created: string;
  checkpoint?: string[];
  analysisBudget?: number;
  analysisPipeline?: number;
  recordVersions?: Record<string, number>;
}
export const SettingsSchema = z.object({
  asrMode: z.enum(["local", "remote"]).optional(),
  uiLanguage: UiLanguageSchema.optional(),
  defaultReportLanguage: ReportLanguageSchema.optional(),
  asrUrl: z.string().url(),
  baseUrl: z.string().url(),
  model: z.string().max(200),
  contextBudget: z.number().int().min(4096).max(200000),
  maxOutputTokens: z.number().int().min(1024).max(32768).optional(),
  thinkingMode: z.enum(["default", "disabled", "enabled"]).optional(),
  consent: z.boolean(),
  visualConsent: z.boolean().optional(),
  visionModel: z.string().max(200).optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;
export interface AsrModelState {
  language: "zh" | "en";
  bytes: number;
  downloadedBytes: number;
  status:
    | "missing"
    | "queued"
    | "checking"
    | "downloading"
    | "ready"
    | "failed"
    | "cancelled";
  error?: string;
  canCancel: boolean;
}
export interface State {
  asrModels?: AsrModelState[];
  appVersion?: string;
  systemLocale?: string;
  templates: AnalysisTemplate[];
  meetings: Meeting[];
  projects: Project[];
  records: RecordItem[];
  jobs: Job[];
  settings: Settings & { hasKey: boolean; hasAsrKey: boolean };
}
export interface Answer {
  text: string;
  evidence: Evidence[];
  coverage: string;
}
export const RequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("asr.models.download"),
    language: z.enum(["zh", "en"]),
  }),
  z.object({
    op: z.literal("asr.models.cancel"),
    language: z.enum(["zh", "en"]),
  }),
  z.object({ op: z.literal("meeting.delete"), id: Id }),
  z.object({ op: z.literal("meeting.restore"), id: Id }),
  z.object({
    op: z.literal("meeting.context"),
    id: Id,
    context: ContextSchema,
  }),
  z.object({
    op: z.literal("project.context"),
    id: Id,
    context: ContextSchema,
  }),
  z.object({ op: z.literal("meeting.reloadDefaults"), id: Id }),
  z.object({
    op: z.literal("template.save"),
    id: Id.optional(),
    name: z.string().trim().min(1).max(200),
    requirements: z.string().trim().min(1).max(20000),
  }),
  z.object({ op: z.literal("template.delete"), id: Id }),
  z.object({ op: z.literal("evidence.resolve"), evidence: EvidenceSchema }),
  z.object({ op: z.literal("state") }),
  z.object({
    op: z.literal("project.create"),
    name: z.string().trim().min(1).max(200),
  }),
  z.object({
    op: z.literal("meeting.create"),
    title: z.string().trim().min(1).max(300),
    projectId: Id.nullable(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  }),
  z.object({
    op: z.literal("meeting.update"),
    id: Id,
    title: z.string().trim().min(1).max(300),
    projectId: Id.nullable(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  }),
  z.object({ op: z.literal("audio.import"), id: Id }),
  z.object({ op: z.literal("media.location"), id: Id }),
  z.object({
    op: z.literal("media.reveal"),
    id: Id,
    kind: z.enum(["original", "microphone", "system", "pending"]),
  }),
  z.object({
    op: z.literal("video.frame.exclude"),
    id: Id,
    frameId: Id,
    excluded: z.boolean(),
  }),
  z.object({
    op: z.literal("video.frame.add"),
    id: Id,
    time: z.number().finite().min(0),
  }),
  z.object({ op: z.literal("settings.testVision") }),
  z.object({ op: z.literal("video.frame.refresh"), id: Id, frameId: Id }),
  z.object({ op: z.literal("screen.sources") }),
  z.object({
    op: z.literal("screen.select"),
    sourceId: z.string().min(1).max(300),
    system: z.boolean(),
  }),
  z.object({ op: z.literal("screen.start"), id: Id }),
  z.object({
    op: z.literal("screen.chunk"),
    id: Id,
    seq: z.number().int().min(0),
    data: z.instanceof(Uint8Array),
  }),
  z.object({
    op: z.literal("screen.stop"),
    id: Id,
    interrupted: z.boolean().optional(),
  }),
  z.object({ op: z.literal("screen.recover"), id: Id }),
  z.object({
    op: z.literal("record.start"),
    id: Id,
    sampleRate: z.number().int().min(8000).max(96000),
  }),
  z.object({
    op: z.literal("record.chunk"),
    id: Id,
    seq: z.number().int().min(0),
    mic: z.instanceof(Uint8Array),
    system: z.instanceof(Uint8Array),
  }),
  z.object({ op: z.literal("record.stop"), id: Id }),
  z.object({
    op: z.literal("transcript.save"),
    id: Id,
    version: z.number().int().min(0),
    segments: z.array(SegmentSchema),
    speakers: z.record(z.string(), z.string().max(200)),
  }),
  z.object({ op: z.literal("transcript.import"), id: Id }),
  z.object({
    op: z.literal("analysis.notes"),
    id: Id,
    analysisId: Id,
    notes: z.string().max(200000),
  }),
  z.object({
    op: z.literal("job.start"),
    id: Id,
    kind: z.enum([
      "transcribe",
      "analyze",
      "speakers",
      "visuals",
      "synthesize",
    ]),
    useVisuals: z.boolean().optional(),
    sourceAnalysisId: Id.optional(),
    expectedSpeakers: z.number().int().min(1).max(50).optional(),
  }),
  z.object({ op: z.literal("job.retry"), id: Id }),
  z.object({ op: z.literal("job.cancel"), id: Id }),
  z.object({
    op: z.literal("proposal.accept"),
    id: Id,
    analysisId: Id,
    index: z.number().int().min(0),
  }),
  z.object({
    op: z.literal("settings.save"),
    settings: SettingsSchema,
    key: z.string().max(10000).optional(),
    asrKey: z.string().max(10000).optional(),
  }),
  z.object({ op: z.literal("settings.test") }),
  z.object({
    op: z.literal("ask"),
    question: z.string().trim().min(1).max(4000),
    projectId: Id.nullable(),
    meetingId: Id.nullable(),
    from: z.string().max(10),
    to: z.string().max(10),
  }),
  z.object({
    op: z.literal("export"),
    id: Id,
    format: z.enum(["md", "srt"]),
    analysisId: Id.optional(),
    minutesId: Id.optional(),
    scope: z.enum(["minutes", "full"]).optional(),
  }),
  z.object({ op: z.literal("backup") }),
  z.object({ op: z.literal("restore") }),
]);
export type Request = z.infer<typeof RequestSchema>;
export interface Bridge {
  invoke: (request: Request) => Promise<any>;
}

export type MediaFileKind = "original" | "microphone" | "system" | "pending";
export interface MediaLocation {
  directory: string;
  files: {
    kind: MediaFileKind;
    label: string;
    path: string;
    exists: boolean;
    bytes?: number;
  }[];
}

export interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;
  kind: "screen" | "window";
}
export interface ScreenCapture {
  status: "recording" | "finalizing" | "failed" | "complete";
  sourceName: string;
  bytes: number;
  nextSeq: number;
  recovered?: boolean;
  error?: string;
}
