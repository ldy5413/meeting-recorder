import {
  ContextSchema,
  type Analysis,
  type AnalysisTemplate,
  type MeetingContext,
  type Claim,
  type Segment,
} from "./types";
import { labelsFor } from "./language";

export const builtinTemplates: AnalysisTemplate[] = [
  {
    id: "project-progress",
    name: "项目进度会",
    builtin: true,
    requirements:
      "按会议概览、项目进展、决策、风险与建议、后续待办组织章节。未提及的栏目省略，合并同一主题。",
  },
  {
    id: "weekly",
    name: "每周周会",
    builtin: true,
    requirements:
      "按人分组，每人包含本周进展、下周计划、阻塞与协助事项，使用 bullet point。未提及的栏目省略。同一人跨窗口合并。有校对姓名或原文明示归属时使用姓名；未命名的单一说话人按原始编号分组，编号只表示发言来源，不确认任务负责人。多人来源或纯画面无法明确归属时列入未确认人员，不从背景名单猜姓名。",
  },
];
export const contextOf = (value?: Partial<MeetingContext>) =>
  ContextSchema.parse(value ?? {});
export const contextInfo = (value: MeetingContext) =>
  [
    value.background,
    value.keywords.length ? `关键词：${value.keywords.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
export function mergeApprovedClaims(
  claims: Claim[],
  segments: Segment[],
  speakers: Record<string, string>,
) {
  const byId = new Map(
    segments.map((s) => [s.id, speakers[s.speaker] || s.speaker]),
  );
  const merged = new Map<string, Claim>();
  for (const c of claims) {
    const identities = [
      ...new Set(
        c.evidence.map((e) =>
          e.frameId ? `frame:${e.frameId}` : byId.get(e.segmentId!),
        ),
      ),
    ].sort();
    const key = JSON.stringify([
      c.kind,
      c.targetId,
      c.change,
      c.text,
      c.owner,
      c.due,
      identities,
    ]);
    const previous = merged.get(key);
    merged.set(key, {
      ...c,
      evidence: [
        ...new Map(
          [...(previous?.evidence ?? []), ...c.evidence].map((e) => [
            JSON.stringify(e),
            e,
          ]),
        ).values(),
      ],
    });
  }
  return [...merged.values()];
}
export function analysisMarkdown(a: Analysis, anchors = false) {
  const labels = labelsFor(a.language);
  const claim = (i: number) => {
    const c = a.claims[i];
    return `${anchors ? `<a id="claim-${i}"></a>\n\n` : ""}- **${a.language ? labels[c.kind] : c.kind}** ${c.text}${c.owner ? ` · ${c.owner}` : ""}${c.due ? ` · ${c.due}` : ""}\n${c.evidence.map((e) => (e.frameId ? `  - [${labels.visualSource}](#f-${e.frameId}): ${e.quote}` : `  - [${labels.source}](#s-${e.segmentId}): ${e.quote}`)).join("\n")}`;
  };
  const section = (
    s: NonNullable<Analysis["sections"]>[number],
    depth: number,
  ): string =>
    `${"#".repeat(Math.min(depth, 6))} ${s.title}\n\n${s.claimIndices.map(claim).join("\n")}\n\n${s.children.map((c) => section(c, depth + 1)).join("\n")}`;
  return a.sections
    ? a.sections.map((s) => section(s, 3)).join("\n")
    : a.claims.map((_, i) => claim(i)).join("\n");
}

/** Merge already-reviewed chapter trees without changing claims or adding headings. */
export function mergeAnalysisSections(
  sections: NonNullable<Analysis["sections"]>,
): NonNullable<Analysis["sections"]> {
  const result = new Map<string, NonNullable<Analysis["sections"]>[number]>();
  for (const section of sections) {
    const previous = result.get(section.title);
    result.set(section.title, {
      title: section.title,
      claimIndices: [
        ...(previous?.claimIndices ?? []),
        ...section.claimIndices,
      ],
      children: mergeAnalysisSections([
        ...(previous?.children ?? []),
        ...section.children,
      ]),
    });
  }
  return [...result.values()];
}
