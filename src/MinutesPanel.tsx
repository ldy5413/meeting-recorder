import { useEffect, useState, type ReactNode } from "react";
import type {
  Analysis,
  AnalysisTemplate,
  Job,
  Meeting,
  MinutesPoint,
  MinutesSection,
  Request,
} from "../shared/types";
import { analysisIsStale } from "../shared/minutes";
import { contextOf } from "../shared/analysis";
import { t, templateName, languageName, uiLocale } from "./i18n";
import "./minutes.css";

export function MinutesPanel({
  meeting,
  analysis,
  templates,
  jobs,
  renderClaim,
  run,
}: {
  meeting: Meeting;
  analysis: Analysis;
  templates: AnalysisTemplate[];
  jobs: Job[];
  renderClaim: (index: number) => ReactNode;
  run: (request: Request) => Promise<unknown>;
}) {
  const [chosen, setChosen] = useState("");
  const [templateId, setTemplate] = useState(
    meeting.context?.templateId ??
      analysis.snapshot?.template.id ??
      "project-progress",
  );
  const [requirements, setRequirements] = useState(
    meeting.context?.additionalRequirements ?? "",
  );
  const [language, setLanguage] = useState<"auto" | "zh-CN" | "en">(
    meeting.context?.reportLanguage ?? "auto",
  );
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<"minutes" | "full">("minutes");
  const minutes =
    analysis.minutes?.find((m) => m.id === chosen) ?? analysis.minutes?.at(-1);
  const busy =
    saving ||
    !!meeting.deletedAt ||
    jobs.some(
      (j) =>
        j.meetingId === meeting.id && ["queued", "running"].includes(j.status),
    );
  const stale = analysisIsStale(meeting, analysis);
  useEffect(() => {
    setChosen("");
  }, [analysis.id]);
  const evidence = (indices: number[]) => (
    <details className="minutes-evidence">
      <summary>
        {t("查看依据（{p0} 条详细分析）", { p0: indices.length })}
      </summary>
      {indices.map((i) => (
        <div key={i}>{renderClaim(i)}</div>
      ))}
    </details>
  );
  const point = (p: MinutesPoint, index: number) => (
    <li key={index}>
      <p>{p.text}</p>
      {evidence(p.sourceIndices)}
    </li>
  );
  const section = (s: MinutesSection, i: number, depth = 0): ReactNode => (
    <section className={`minutes-section depth-${depth}`} key={i}>
      {depth ? <h4>{s.title}</h4> : <h3>{s.title}</h3>}
      {!!s.items.length && <ul>{s.items.map(point)}</ul>}
      {s.children.map((c, index) => section(c, index, depth + 1))}
    </section>
  );
  return (
    <div className="minutes-panel">
      {minutes ? (
        <>
          {!!minutes.content.overview.length && (
            <div className="minutes-overview">
              <h3>{t("全场总览")}</h3>
              <ul>
                {minutes.content.overview.map((p, i) => (
                  <li key={i}>
                    <p>{p.text}</p>
                  </li>
                ))}
              </ul>
              {evidence([
                ...new Set(
                  minutes.content.overview.flatMap((p) => p.sourceIndices),
                ),
              ])}
            </div>
          )}
          <div className="minutes-toolbar">
            <label>
              {t("纪要版本")}
              <select
                aria-label={t("纪要版本")}
                value={minutes.id}
                onChange={(e) => setChosen(e.target.value)}
              >
                {analysis.minutes!.map((m, i) => (
                  <option key={m.id} value={m.id}>
                    {i + 1} · {templateName(m.template)} ·{" "}
                    {new Date(m.created).toLocaleString(uiLocale())}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {t("报告语言")}: {languageName(minutes.language.locale)}
            </span>
            <select
              aria-label={t("纪要导出范围")}
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
            >
              <option value="minutes">{t("仅导出纪要")}</option>
              <option value="full">{t("包含详细分析与证据")}</option>
            </select>
            <button
              onClick={() =>
                void run({
                  op: "export",
                  id: meeting.id,
                  analysisId: analysis.id,
                  minutesId: minutes.id,
                  scope,
                  format: "md",
                }).catch(() => {})
              }
            >
              {t("导出纪要 Markdown")}
            </button>
          </div>
          {minutes.content.overview.length ? (
            <>{minutes.content.sections.map((s, i) => section(s, i))}</>
          ) : (
            <p className="muted">{t("详细分析中没有通过审核的事实条目。")}</p>
          )}
        </>
      ) : (
        <div className="minutes-empty">
          <h3>{t("把整场会议的重点放在一起")}</h3>
          <p>{t("基于已有详细分析归并议题，按模板提炼结果与下一步。")}</p>
        </div>
      )}
      <details className="minutes-settings" open={!minutes}>
        <summary>{t("提炼设置")}</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              await run({
                op: "meeting.context",
                id: meeting.id,
                context: {
                  ...contextOf(meeting.context),
                  templateId,
                  additionalRequirements: requirements,
                  reportLanguage: language,
                },
              });
              await run({
                op: "job.start",
                id: meeting.id,
                kind: "synthesize",
                sourceAnalysisId: analysis.id,
              });
              setChosen("");
            } catch {
              /* The shared request handler displays errors. */
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            {t("纪要模板")}
            <select
              aria-label={t("纪要模板")}
              value={templateId}
              onChange={(e) => setTemplate(e.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {templateName(template)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("报告语言")}
            <select
              aria-label={t("报告语言")}
              value={language}
              onChange={(e) => setLanguage(e.target.value as typeof language)}
            >
              <option value="auto">{t("沿用详细分析语言")}</option>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {t("本次提炼重点")}
            <textarea
              aria-label={t("本次提炼重点")}
              rows={3}
              value={requirements}
              maxLength={10000}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder={t(
                "例如：重点说明讨论结果、分歧和下一步，技术参数按需保留。",
              )}
            />
          </label>
          <p className="muted">
            {t("重新提炼会保留已有纪要版本，复用此份详细分析。")}
          </p>
          <button className="primary" disabled={busy || stale} type="submit">
            {busy
              ? t("处理中")
              : minutes
                ? t("重新提炼纪要")
                : t("生成全场纪要")}
          </button>
        </form>
      </details>
    </div>
  );
}
