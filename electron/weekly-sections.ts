import { z } from "zod";
import type { AnalysisSection, Claim, Segment } from "../shared/types";
import { isAnonymousSpeakerLabel } from "../shared/speakers";
import { reportLabels, type ReportLabels } from "../shared/language";

export const weeklyColumns = ["progress", "plans", "blockers"] as const;
export const unconfirmed = "__unconfirmed__";

/** A single unnamed voice can identify the source of a claim, never its task owner. */
export function weeklySourceSpeakers(
  claims: Claim[],
  segments: Segment[],
  speakers: Record<string, string>,
) {
  const byId = new Map(segments.map((s) => [s.id, s.speaker]));
  return claims.map((claim) => {
    const ids = [
      ...new Set(
        claim.evidence.flatMap((e) => {
          const id = e.segmentId && byId.get(e.segmentId);
          return id ? [id] : [];
        }),
      ),
    ];
    if (ids.length !== 1) return null;
    const id = ids[0],
      name = speakers[id]?.trim();
    if (
      (name && !isAnonymousSpeakerLabel(name)) ||
      /^(?:unknown|unresolved(?:-\d+)?|non-speech)$/i.test(id)
    )
      return null;
    return id;
  });
}

export function weeklyPeople(
  claims: Claim[],
  speakers: Record<string, string>,
  sourceSpeakers: (string | null)[] = [],
) {
  return [
    unconfirmed,
    ...new Set(
      [...Object.values(speakers), ...claims.flatMap((c) => c.owner ?? [])]
        .map((name) => name.trim())
        .filter((name) => name && !isAnonymousSpeakerLabel(name)),
    ),
    ...new Set(sourceSpeakers.flatMap((id) => (id ? [id] : []))),
  ];
}

export interface WeeklyPersonAdjustment {
  claimIndex: number;
  originalPerson: string | null;
  person: string;
  reason: "source-speaker" | "unconfirmed";
}

/** Models classify facts; code owns the weekly template's two-level structure. */
export function buildWeeklySections(
  value: unknown,
  claimCount: number,
  people: string[],
  sourceSpeakers: (string | null)[] = [],
  labels: ReportLabels = reportLabels["zh-CN"],
) {
  const { assignments } = z
    .object({
      assignments: z.array(
        z.object({
          index: z.number().int().min(0),
          person: z.string().trim().min(1).max(200).nullable(),
          column: z.enum(weeklyColumns),
        }),
      ),
    })
    .parse(value);
  const counts = new Map<number, number>();
  assignments.forEach(({ index }) =>
    counts.set(index, (counts.get(index) ?? 0) + 1),
  );
  const missing = Array.from({ length: claimCount }, (_, i) => i).filter(
    (i) => !counts.has(i),
  );
  const duplicate = [...counts].filter(([, n]) => n > 1).map(([i]) => i);
  const outside = [...counts.keys()].filter((i) => i >= claimCount);
  if (missing.length || duplicate.length || outside.length)
    throw new Error(
      `周会 assignments 必须完整覆盖 allowedIndices，每个索引恰好一次。遗漏 ${JSON.stringify(missing)}；重复 ${JSON.stringify(duplicate)}；越界 ${JSON.stringify(outside)}。只输出 {assignments:[{index,person,column}]}，不删除已审核条目；person 只能选 allowedPeople 或 null，column 只能选 allowedColumns。`,
    );

  const allowed = new Set(people);
  const anonymous = new Set(sourceSpeakers.filter((id) => id !== null));
  const personAdjustments: WeeklyPersonAdjustment[] = [];
  const grouped = new Map<string, Map<string, number[]>>();
  for (const item of assignments.sort((a, b) => a.index - b.index)) {
    const person =
      item.person &&
      item.person !== unconfirmed &&
      allowed.has(item.person) &&
      !anonymous.has(item.person)
        ? item.person
        : (sourceSpeakers[item.index] ?? unconfirmed);
    if (person !== (item.person ?? unconfirmed))
      personAdjustments.push({
        claimIndex: item.index,
        originalPerson: item.person,
        person,
        reason: person === unconfirmed ? "unconfirmed" : "source-speaker",
      });
    const columns = grouped.get(person) ?? new Map<string, number[]>();
    columns.set(item.column, [...(columns.get(item.column) ?? []), item.index]);
    grouped.set(person, columns);
  }
  const sections: AnalysisSection[] = [...grouped].map(([title, columns]) => ({
    title: title === unconfirmed ? labels.unconfirmed : title,
    claimIndices: [],
    children: weeklyColumns.flatMap((title) => {
      const claimIndices = columns.get(title);
      return claimIndices
        ? [{ title: labels[title], claimIndices, children: [] }]
        : [];
    }),
  }));
  return { sections, personAdjustments };
}
