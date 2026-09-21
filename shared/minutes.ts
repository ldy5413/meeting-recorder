import type {
  Analysis,
  Meeting,
  MeetingMinutes,
  MinutesContent,
  MinutesPoint,
  MinutesSection,
} from "./types";
import { MinutesContentSchema } from "./types";

export function minutesPoints(
  content: MinutesContent,
): { point: MinutesPoint; headings: string[] }[] {
  const walk = (
    sections: MinutesSection[],
    parents: string[],
  ): ReturnType<typeof minutesPoints> =>
    sections.flatMap((s) => [
      ...s.items.map((point) => ({ point, headings: [...parents, s.title] })),
      ...walk(s.children, [...parents, s.title]),
    ]);
  return [
    ...content.overview.map((point) => ({ point, headings: [] })),
    ...walk(content.sections, []),
  ];
}

export function validateMinutes(
  value: unknown,
  claimCount: number,
): MinutesContent {
  const content = MinutesContentSchema.parse(value);
  const walk = (sections: MinutesSection[], depth: number) => {
    if (depth > 3 && sections.length) throw new Error("纪要章节层级过深");
    for (const section of sections) {
      if (!section.items.length && !section.children.length)
        throw new Error("纪要不能包含空章节");
      walk(section.children, depth + 1);
    }
  };
  walk(content.sections, 1);
  const points = minutesPoints(content);
  if (claimCount && (!content.overview.length || !content.sections.length))
    throw new Error("纪要须包含全场总览和模板章节");
  if (!claimCount && points.length)
    throw new Error("没有详细条目，不能生成事实纪要");
  if (
    points.length > 80 ||
    points.reduce((n, p) => n + p.point.text.length, 0) > 12000
  )
    throw new Error("纪要过长，请归并议题并提炼关键结果");
  for (const { point } of points) {
    if (
      new Set(point.sourceIndices).size !== point.sourceIndices.length ||
      point.sourceIndices.some((i) => i >= claimCount)
    )
      throw new Error(
        `纪要依据编号无效：合法范围 0 到 ${claimCount - 1}，每条依据不得重复`,
      );
  }
  return content;
}

export function analysisIsStale(meeting: Meeting, analysis: Analysis) {
  return (
    analysis.version !== meeting.version ||
    !!(analysis.visual && analysis.visual.revision !== meeting.video?.revision)
  );
}
export function currentMinutes(meeting: Meeting): MeetingMinutes | undefined {
  const analysis = meeting.analyses.at(-1);
  return analysis && !analysisIsStale(meeting, analysis)
    ? analysis.minutes?.at(-1)
    : undefined;
}

export function minutesMarkdown(minutes: MeetingMinutes, links = false) {
  const point = (p: MinutesPoint) =>
    `- ${p.text}${links ? ` ${p.sourceIndices.map((i) => `[${i + 1}](#claim-${i})`).join(" ")}` : ""}`;
  const section = (s: MinutesSection, level: number): string =>
    `${"#".repeat(level)} ${s.title}\n\n${s.items.map(point).join("\n")}\n\n${s.children.map((c) => section(c, level + 1)).join("\n")}`;
  return `${minutes.content.overview.map(point).join("\n\n")}\n\n${minutes.content.sections.map((s) => section(s, 3)).join("\n")}`;
}
