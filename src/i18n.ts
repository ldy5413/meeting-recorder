import { useSyncExternalStore } from "react";
import type { AnalysisTemplate } from "../shared/types";
import {
  resolveUiLocale,
  reportLabels,
  type UiLocale,
} from "../shared/language";
import {
  translate,
  translateMessage,
  countMessage,
  type MessageKey,
  type MessageParams,
} from "../shared/messages";
let locale: UiLocale = "zh-CN";
const listeners = new Set<() => void>();
export function setUiLanguage(
  language?: string,
  systemLocale = navigator.language,
) {
  const next = resolveUiLocale(language, systemLocale);
  document.documentElement.lang = next;
  document.title = translate(next, "会议手记");
  if (next !== locale) {
    locale = next;
    for (const listener of listeners) listener();
  }
}
export const uiLocale = () => locale;
export const count = (
  unit: Parameters<typeof countMessage>[1],
  value: number,
) => countMessage(locale, unit, value);
export const t = (key: MessageKey, params?: MessageParams) =>
  translate(locale, key, params);
export const localizeMessage = (message: string) =>
  translateMessage(locale, message);
export function useUiLanguage() {
  return useSyncExternalStore((callback) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  }, uiLocale);
}
export function uiSpeakerLabel(id: string) {
  const labels = reportLabels[locale];
  return id === "non-speech"
    ? labels.nonSpeech
    : id === "unknown"
      ? labels.unknownSpeaker
      : /^unresolved-\d+$/.test(id)
        ? `${labels.unknownSpeaker} ${id.slice(11)}`
        : /^speaker-\d+$/.test(id)
          ? `${labels.speaker} ${id.slice(8)}`
          : id;
}
const englishTemplates: Record<string, { name: string; requirements: string }> =
  {
    "project-progress": {
      name: "Project progress",
      requirements:
        "Organize by overview, project progress, decisions, risks and suggestions, and follow-up actions. Omit sections not discussed and merge repeated topics.",
    },
    weekly: {
      name: "Weekly meeting",
      requirements:
        "Group by person with bullet points for this week's progress, next week's plans, and blockers or help needed. Omit empty sections and merge the same person across batches. Use reviewed names or explicit attribution only. For an unnamed single speaker, group by the original voice ID; this identifies the source, not ownership. Use an unconfirmed group for mixed speakers or visual-only content. Never guess names from background information.",
    },
  };
export function templateName(template: AnalysisTemplate) {
  return template.builtin && locale === "en"
    ? (englishTemplates[template.id]?.name ?? template.name)
    : template.name;
}
export function templateRequirements(template: AnalysisTemplate) {
  return template.builtin && locale === "en"
    ? (englishTemplates[template.id]?.requirements ?? template.requirements)
    : template.requirements;
}
export function languageName(language: string) {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(language) ??
      language
    );
  } catch {
    return language;
  }
}
