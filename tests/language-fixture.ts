import { minutesFixture } from "./minutes-fixture";
/** Extra protocol steps for existing synthetic model servers. Language behavior is tested separately. */
export function languageFixture(data: any) {
  const value =
    data?.languageTask === "detect-report"
      ? {
          languages: data.samples.map((_: unknown, index: number) => ({
            index,
            locale: "zh-CN",
          })),
        }
      : data?.languageTask === "answer-language"
        ? { locale: "zh-CN", noEvidence: "现有资料不足以回答。" }
        : undefined;
  return value ? { raw: JSON.stringify(value), value } : undefined;
}
export function languageHttpFixture(
  data: unknown,
  res: import("node:http").ServerResponse,
) {
  const output = languageFixture(data) ?? minutesFixture(data);
  if (!output) return false;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: output.raw } }],
    }),
  );
  return true;
}
