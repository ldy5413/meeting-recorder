/** Synthetic protocol responses, never used by production or real-data validation. */
export function minutesFixture(data: any) {
  if (!data?.minutesTask) return undefined;
  let value;
  if (data.minutesTask === "agenda") {
    value = {
      topics: [
        {
          text: "Synthetic meeting priorities",
          sourceIndices: data.facts.map((f: any) => f.index),
        },
      ],
      detailIndices: [],
    };
  } else if (data.minutesTask === "compose") {
    const facts = data.notes;
    const point = (f: any) => ({
      text: f.text,
      sourceIndices: f.sourceIndices,
    });
    value =
      data.context.template.id === "weekly"
        ? {
            overview: facts.slice(0, 1).map(point),
            entries: facts.map((f: any) => ({
              ...point(f),
              person:
                f.sourceSpeakers.length === 1 && f.speech
                  ? f.sourceSpeakers[0]
                  : null,
              column: f.kind === "todo" ? "plans" : "progress",
            })),
          }
        : {
            overview: facts.slice(0, 1).map(point),
            sections: [
              { title: "后续待办", items: facts.map(point), children: [] },
            ],
          };
  } else if (data.minutesTask === "support")
    value = {
      reviews: data.proposed.map((p: any) => ({
        index: p.index,
        supported: true,
        reason: "Synthetic fixture evidence",
      })),
    };
  else if (data.minutesTask === "coverage") value = { missing: [] };
  else throw new Error("Unsupported synthetic minutes stage");
  return { value, raw: JSON.stringify(value) };
}
