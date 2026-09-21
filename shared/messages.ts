import { messages } from "./messages-data";
import type { UiLocale } from "./language";
export type MessageKey = keyof typeof messages;
export type MessageParams = Record<string, string | number | undefined>;
export interface Message {
  key: string;
  params?: MessageParams;
}
const countUnits = {
  speaker: ["位说话人", "speaker"],
  segment: ["段原文", "segment"],
  meeting: ["场会议", "meeting"],
  project: ["个项目", "project"],
  keyword: ["个关键词", "keyword"],
  item: ["条", "item"],
} as const;
export function countMessage(
  locale: UiLocale,
  unit: keyof typeof countUnits,
  count: number,
) {
  const number = new Intl.NumberFormat(locale).format(count);
  const label =
    locale === "zh-CN"
      ? countUnits[unit][0]
      : countUnits[unit][1] +
        (new Intl.PluralRules(locale).select(count) === "one" ? "" : "s");
  return `${number} ${label}`;
}
export function translate(
  locale: UiLocale,
  key: MessageKey,
  params: MessageParams = {},
) {
  const pattern: string = locale === "en" ? messages[key] : key;
  return pattern.replace(/\{(p\d+)\}/g, (match, name) =>
    String(params[name] ?? match),
  );
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = (Object.keys(messages) as MessageKey[])
  .flatMap((key) => {
    if (!/\{p\d+\}/.test(key)) return [];
    const names = key.match(/p\d+(?=\})/g)!;
    return [key, messages[key]].map((pattern) => ({
      key,
      names,
      regex: new RegExp(
        "^" +
          pattern
            .split(/\{p\d+\}/)
            .map(escape)
            .join("([\\s\\S]*?)") +
          "$",
      ),
    }));
  })
  .sort(
    (a, b) =>
      b.key.replace(/\{p\d+\}/g, "").length -
      a.key.replace(/\{p\d+\}/g, "").length,
  );
const reverse = new Map(
  Object.entries(messages).map(([key, en]) => [
    en as string,
    key as MessageKey,
  ]),
);
/** Compatibility for legacy string errors/progress; new IPC also carries this descriptor. */
export function describeMessage(text: string): Message | undefined {
  const remoteStates: Record<string, MessageKey> = {
    upload: "上传音频",
    queued: "排队中",
    cancelled: "已取消",
    complete: "完成",
  };
  if (remoteStates[text]) return { key: remoteStates[text] };
  if (Object.hasOwn(messages, text)) return { key: text };
  const key = reverse.get(text);
  if (key) return { key };
  for (const pattern of patterns) {
    const match = pattern.regex.exec(text);
    if (match)
      return {
        key: pattern.key,
        params: Object.fromEntries(
          pattern.names.map((name, i) => [name, match[i + 1]]),
        ),
      };
  }
}
export function translateMessage(
  locale: UiLocale,
  text: string,
  depth = 0,
): string {
  const descriptor = describeMessage(text);
  const params =
    descriptor?.params && depth < 3
      ? Object.fromEntries(
          Object.entries(descriptor.params).map(([key, value]) => [
            key,
            typeof value === "string"
              ? translateMessage(locale, value, depth + 1)
              : value,
          ]),
        )
      : descriptor?.params;
  return descriptor
    ? translate(locale, descriptor.key as MessageKey, params)
    : text;
}
