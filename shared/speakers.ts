import type { Segment } from "./types";
import type { ReportLabels } from "./language";

/** Diarization labels identify a voice, not a confirmed person's name. */
export function isAnonymousSpeakerLabel(value: string) {
  if (
    /^(?:unconfirmed(?:\s+(?:speaker|person))?(?:[\s_#–—-]*\d+)?|silence\s*\/\s*non-speech)$/i.test(
      value.normalize("NFKC").trim(),
    )
  )
    return true;
  return /^(?:(?:speaker|spk|unresolved)[\s_#–—-]*\d+|(?:说话人|发言人|发言者|待确认)[\s_#–—-]*\d+|unknown|unresolved|non[\s_-]*speech|未知(?:说话人|人员)?|未确认(?:人员)?|待确认(?:人员)?|静音\s*\/\s*非语音)$/i.test(
    value.normalize("NFKC").trim(),
  );
}

export const speakerLabel = (id: string, labels?: ReportLabels) =>
  id === "non-speech"
    ? (labels?.nonSpeech ?? "静音 / 非语音")
    : id === "unknown"
      ? (labels?.unknownSpeaker ?? "待确认")
      : /^unresolved-\d+$/.test(id)
        ? `${labels?.unknownSpeaker ?? "待确认"} ${id.slice(11)}`
        : /^speaker-\d+$/.test(id)
          ? `${labels?.speaker ?? "说话人"} ${id.slice(8)}`
          : id;

export const speakerIds = (segments: Segment[]) =>
  [...new Set(segments.map((s) => s.speaker))].filter(
    (s) => s !== "non-speech",
  );

export const speakerCount = (segments: Segment[]) =>
  speakerIds(segments).filter(
    (s) => s !== "unknown" && !/^unresolved-\d+$/.test(s),
  ).length;
