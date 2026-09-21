import { z } from "zod";
import {
  ClaimSchema,
  EvidenceSchema,
  Id,
  type Claim,
  type VisualFrame,
} from "../shared/types";
import { frameEvidenceText, parameterText } from "../shared/visual";

export interface VisualEvidenceSource {
  id: string;
  quote: string;
  parameterIndex?: number;
}
export interface VisualQuoteBinding {
  claimIndex: number;
  evidenceIndex: number;
  frameId: string;
  sourceId: string;
  quote: string;
}

/** Source fragments remain literal substrings, including code, whitespace and punctuation. */
export function visualEvidenceSources(
  frame: VisualFrame,
): VisualEvidenceSource[] {
  const split = (text: string) => {
    const parts: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      let rest = line.trim();
      while (rest) {
        let end = Math.min(rest.length, 1200);
        if (end < rest.length) {
          const boundary = Math.max(
            ...["。", "；", "; ", ". ", "，", ", ", " "].map((s) =>
              rest.lastIndexOf(s, end - 1),
            ),
          );
          if (boundary >= 600) end = boundary + 1;
          if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
        }
        parts.push(rest.slice(0, end));
        rest = rest.slice(end);
      }
    }
    return parts;
  };
  return [
    ...split(frame.text).map((quote, index) => ({
      id: `text:${index}`,
      quote,
    })),
    ...(frame.parameters ?? []).flatMap((p, parameterIndex) =>
      split(parameterText(p)).map((quote, index) => ({
        id: `parameter:${parameterIndex}:${index}`,
        quote,
        parameterIndex,
      })),
    ),
  ];
}

const sourceReference = z.object({
  frameId: Id,
  sourceId: z.string().min(1).max(80),
  quote: z.never().optional(),
  segmentId: z.never().optional(),
});
const candidateSchema = z.object({
  claims: z.array(
    ClaimSchema.extend({
      evidence: z
        .array(
          z.union([
            sourceReference,
            EvidenceSchema.and(z.object({ sourceId: z.never().optional() })),
          ]),
        )
        .min(1),
    }),
  ),
});

/** Models choose a local source ID; only the application writes the evidence quote. */
export function bindVisualEvidence(value: unknown, frames: VisualFrame[]) {
  const catalogs = new Map(frames.map((f) => [f.id, visualEvidenceSources(f)]));
  const quoteBindings: VisualQuoteBinding[] = [];
  const claims = candidateSchema
    .parse(value)
    .claims.map((claim, claimIndex) => {
      const parameterRefs = [...(claim.parameterRefs ?? [])];
      const evidence = claim.evidence.map((entry, evidenceIndex) => {
        if (!entry.sourceId) return entry;
        const sources = catalogs.get(entry.frameId!);
        const source = sources?.find((s) => s.id === entry.sourceId);
        if (!source)
          throw new Error(
            `画面证据编号不存在：${entry.frameId} / ${entry.sourceId}。只选择此画面 evidenceSources 中的 id；合法编号：${sources?.map((s) => s.id).join(", ") || "无，此画面不在当前输入"}`,
          );
        if (
          source.parameterIndex !== undefined &&
          !parameterRefs.some(
            (r) =>
              r.frameId === entry.frameId && r.index === source.parameterIndex,
          )
        )
          parameterRefs.push({
            frameId: entry.frameId!,
            index: source.parameterIndex,
          });
        quoteBindings.push({
          claimIndex,
          evidenceIndex,
          frameId: entry.frameId!,
          sourceId: source.id,
          quote: source.quote,
        });
        return { frameId: entry.frameId, quote: source.quote };
      });
      return ClaimSchema.parse({
        ...claim,
        evidence,
        ...(parameterRefs.length ? { parameterRefs } : {}),
      });
    });
  return { claims, quoteBindings };
}

export interface VisualQuoteRepair {
  claimIndex: number;
  evidenceIndex: number;
  frameId: string;
  originalQuote: string;
  quote: string;
}

/** A deliberately narrow Markdown view; keep offsets into the untouched source. */
function withoutBold(text: string) {
  const removed = new Set<number>();
  const starts = new Map<number, number>();
  const ends = new Map<number, number>();
  for (const match of text.matchAll(/\*\*([^\s*](?:[^*\r\n]*[^\s*])?)\*\*/g)) {
    const start = match.index;
    const end = start + match[0].length;
    // Do not reinterpret arithmetic, escaped markers, or inline/fenced code.
    const line = text.slice(
      text.lastIndexOf("\n", start) + 1,
      text.indexOf("\n", end) < 0 ? text.length : text.indexOf("\n", end),
    );
    if (
      /[\w*\\]/.test(text[start - 1] ?? "") ||
      /[\w*]/.test(text[end] ?? "") ||
      line.includes("`") ||
      text.includes("```") ||
      text.includes("~~~")
    )
      continue;
    for (const index of [start, start + 1, end - 2, end - 1])
      removed.add(index);
    starts.set(start + 2, start);
    ends.set(end - 3, end);
  }
  const offsets: { start: number; end: number }[] = [];
  let value = "";
  for (let i = 0; i < text.length; i++) {
    if (removed.has(i)) continue;
    value += text[i];
    offsets.push({ start: starts.get(i) ?? i, end: ends.get(i) ?? i + 1 });
  }
  return { value, offsets };
}

/** Restore an exact quote only when bold formatting is the sole, unambiguous difference. */
export function restoreVisualQuotes(claims: Claim[], frames: VisualFrame[]) {
  const repairs: VisualQuoteRepair[] = [];
  const restored = claims.map((claim, claimIndex) => ({
    ...claim,
    evidence: claim.evidence.map((evidence, evidenceIndex) => {
      if (!evidence.frameId) return evidence;
      const frame = frames.find((f) => f.id === evidence.frameId);
      if (!frame || frameEvidenceText(frame).includes(evidence.quote))
        return evidence;
      const quote = withoutBold(evidence.quote).value;
      if (!quote.trim()) return evidence;
      const matches: string[] = [];
      for (const source of [
        frame.text,
        ...(frame.parameters ?? []).map(parameterText),
      ]) {
        const view = withoutBold(source);
        let at = view.value.indexOf(quote);
        while (at >= 0) {
          matches.push(
            source.slice(
              view.offsets[at].start,
              view.offsets[at + quote.length - 1].end,
            ),
          );
          if (matches.length > 1) return evidence;
          at = view.value.indexOf(quote, at + 1);
        }
      }
      const exact = matches[0];
      if (!exact || exact.length > 2000) return evidence;
      repairs.push({
        claimIndex,
        evidenceIndex,
        frameId: frame.id,
        originalQuote: evidence.quote,
        quote: exact,
      });
      return { ...evidence, quote: exact };
    }),
  }));
  return { claims: restored, quoteRepairs: repairs };
}
