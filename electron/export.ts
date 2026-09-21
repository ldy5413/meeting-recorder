import { labelsFor } from "../shared/language";
import { analysisMarkdown } from "../shared/analysis";
import { frameEvidenceText } from "../shared/visual";
import { speakerLabel } from "../shared/speakers";
import type { Meeting } from "../shared/types";
import { analysisIsStale, minutesMarkdown } from "../shared/minutes";
export function timestamp(seconds: number, srt = false) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${srt ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
}
export function subtitle(m: Meeting) {
  return [...m.segments]
    .sort((a, b) => a.start - b.start)
    .map(
      (s, i) =>
        `${i + 1}\n${timestamp(s.start, true)} --> ${timestamp(s.end, true)}\n${m.speakers[s.speaker] || speakerLabel(s.speaker)}: ${s.text}\n`,
    )
    .join("\n");
}
export function markdown(
  m: Meeting,
  analysisId?: string,
  assetFolder = "frames",
  options: { minutesId?: string; scope?: "minutes" | "full" } = {},
) {
  const a = analysisId
    ? m.analyses.find((a) => a.id === analysisId)
    : m.analyses.at(-1);
  if (analysisId && !a) throw new Error("分析版本不存在");
  const minutes = options.minutesId
    ? a?.minutes?.find((s) => s.id === options.minutesId)
    : a?.minutes?.at(-1);
  if (options.minutesId && !minutes) throw new Error("纪要版本不存在");
  if (options.scope === "minutes") {
    if (!minutes || !a) throw new Error("请先生成全场纪要");
    const labels = labelsFor(minutes.language);
    return `# ${m.title}\n\n${m.occurredAt ?? m.created} · ${labels.transcriptVersion} ${a.version}${analysisIsStale(m, a) ? ` · ${labels.stale}` : ""}\n\n${minutesMarkdown(minutes)}`;
  }
  const labels = labelsFor(a?.language);
  const frames =
    a?.visual?.frames.filter((f) =>
      a.claims.some((c) => c.evidence.some((e) => e.frameId === f.id)),
    ) ?? [];
  const visual = frames.length
    ? `\n## ${labels.visuals}\n\n${labels.visualNotice}\n\n${frames.map((f) => `<a id="f-${f.id}"></a>\n\n**${timestamp(f.start)} · ${f.title}**\n\n![${labels.frame}](<${assetFolder}/${f.file}>)\n\n${frameEvidenceText(f)}${f.uncertain ? `\n\n${labels.uncertain}: ${f.uncertain}` : ""}`).join("\n\n")}`
    : "";
  const overview = minutes
    ? `## ${labelsFor(minutes.language).summary}\n\n${minutesMarkdown(minutes, true)}\n\n`
    : "";
  // Keep the immutable detailed claims as link targets even when a manual note exists.
  const detail = a
    ? minutes
      ? analysisMarkdown(a, true)
      : (a.editedNotes ?? analysisMarkdown(a))
    : "";
  return `# ${m.title}\n\n${m.occurredAt ?? m.created} · ${labels.transcriptVersion} ${a?.version ?? m.version}${a?.visual ? ` · ${labels.withVisuals}` : ` · ${labels.audioOnly}`}\n\n${a && analysisIsStale(m, a) ? `**${labels.stale}**\n\n` : ""}${overview}${a ? `## ${labels.notes}\n\n${detail}\n\n${minutes && a.editedNotes ? `${a.editedNotes}\n\n` : ""}` : ""}## ${labels.transcript}\n\n${m.segments.map((s) => `<a id="s-${s.id}"></a>\n\n**${timestamp(s.start)} · ${m.speakers[s.speaker] || speakerLabel(s.speaker, labels)}**\n\n${s.text}`).join("\n\n")}\n${visual}`;
}
