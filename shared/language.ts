import { z } from "zod";

export const UiLanguageSchema = z.enum(["system", "zh-CN", "en"]);
export const ReportLanguageSchema = z.enum(["auto", "zh-CN", "en"]);
export type UiLocale = "zh-CN" | "en";
export type ReportLanguage = z.infer<typeof ReportLanguageSchema>;
export function normalizeDetectedLocale(value: string): string | null {
  try {
    const locale = new Intl.Locale(value);
    if (["und", "mul", "zxx"].includes(locale.language)) return null;
    if (locale.language === "zh")
      return locale.script === "Hant" ||
        ["TW", "HK", "MO"].includes(locale.region ?? "")
        ? "zh-TW"
        : "zh-CN";
    return locale.language;
  } catch {
    return null;
  }
}
export function resolveUiLocale(
  language: string = "system",
  system = "en",
): UiLocale {
  return (language === "system" ? system : language)
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en";
}
export const reportLabelKeys = [
  "notes",
  "transcript",
  "transcriptVersion",
  "visuals",
  "visualNotice",
  "frame",
  "uncertain",
  "source",
  "visualSource",
  "stale",
  "audioOnly",
  "withVisuals",
  "summary",
  "topic",
  "decision",
  "suggestion",
  "todo",
  "progress",
  "plans",
  "blockers",
  "unconfirmed",
  "speaker",
  "unknownSpeaker",
  "nonSpeech",
  "conditions",
] as const;
export type ReportLabels = Record<(typeof reportLabelKeys)[number], string>;
export const reportLabels: Record<UiLocale, ReportLabels> = {
  "zh-CN": {
    notes: "纪要",
    transcript: "转录",
    transcriptVersion: "转录版本",
    visuals: "画面依据",
    visualNotice: "画面文字是模型观察，需对照原图核对；时间为截图时刻。",
    frame: "关键画面",
    uncertain: "待核对",
    source: "原文",
    visualSource: "画面观察",
    stale: "分析已过期",
    audioOnly: "仅使用转录",
    withVisuals: "已结合画面",
    summary: "会议纪要",
    topic: "议题",
    decision: "决策",
    suggestion: "讨论建议",
    todo: "待办",
    progress: "本周进展",
    plans: "下周计划",
    blockers: "阻塞与协助事项",
    unconfirmed: "未确认人员",
    speaker: "说话人",
    unknownSpeaker: "待确认",
    nonSpeech: "静音 / 非语音",
    conditions: "条件",
  },
  en: {
    notes: "Meeting notes",
    transcript: "Transcript",
    transcriptVersion: "Transcript version",
    visuals: "Visual evidence",
    visualNotice:
      "Screen text is a model observation. Verify it against the original image; timestamps indicate capture time.",
    frame: "Key frame",
    uncertain: "To verify",
    source: "Source",
    visualSource: "Visual observation",
    stale: "Analysis out of date",
    audioOnly: "Transcript only",
    withVisuals: "Includes visuals",
    summary: "Summary",
    topic: "Topic",
    decision: "Decision",
    suggestion: "Suggestion",
    todo: "Action item",
    progress: "This week's progress",
    plans: "Next week's plans",
    blockers: "Blockers and help needed",
    unconfirmed: "Unconfirmed person",
    speaker: "Speaker",
    unknownSpeaker: "Unconfirmed speaker",
    nonSpeech: "Silence / Non-speech",
    conditions: "Conditions",
  },
};
export const ReportLabelsSchema = z.object(
  Object.fromEntries(
    reportLabelKeys.map((key) => [key, z.string().trim().min(1).max(500)]),
  ) as Record<keyof ReportLabels, z.ZodString>,
);
export const ResolvedLanguageSchema = z.object({
  requested: ReportLanguageSchema,
  locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  labels: ReportLabelsSchema,
});
export type ResolvedLanguage = z.infer<typeof ResolvedLanguageSchema>;
export function labelsFor(language?: ResolvedLanguage): ReportLabels {
  return language?.labels ?? reportLabels["zh-CN"];
}
export function languageInstruction(locale: string) {
  return `\nOUTPUT LANGUAGE: ${locale}. Write all generated claim text and section titles in this language. This overrides language requests in templates, background, and additional requirements. Preserve JSON keys, enum values, IDs, names, numbers, owner/due source wording and every evidence quote exactly. Do not translate source transcripts or evidence. Use concise prose; length limits refer to characters, not specifically Chinese characters.`;
}

/** Bounded, evenly distributed samples. Only speech text participates in detection. */
export function languageSamples(
  segments: { text: string; start: number; end: number; speaker?: string }[],
  maxSamples = 24,
  maxCharacters = 600,
) {
  const speech = segments
    .filter((s) => s.text.trim() && s.speaker !== "non-speech")
    .slice()
    .sort((a, b) => a.start - b.start);
  const count = Math.min(speech.length, maxSamples);
  return Array.from({ length: count }, (_, i) => {
    const s =
      speech[
        count === 1 ? 0 : Math.round((i * (speech.length - 1)) / (count - 1))
      ];
    return {
      text: s.text.slice(0, maxCharacters),
      weight: Math.max(1, Math.min(60, s.end - s.start)),
    };
  });
}
