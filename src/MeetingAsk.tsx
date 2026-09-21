import { localizeMessage, t } from "./i18n";
import { useRef, useState, type ReactNode } from "react";
import type { Answer, Evidence, Request, State } from "../shared/types";
import { PageHeading } from "./AppShell";

export function MeetingAsk({
  state,
  initialScope,
  run,
  refs,
}: {
  state: State;
  initialScope: string;
  run: (r: Request) => Promise<any>;
  refs: (e: Evidence[]) => ReactNode;
}) {
  const [scope, setScope] = useState(initialScope);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const resetAnswer = () => {
    generation.current++;
    setAnswer(null);
    setError("");
    setBusy(false);
  };
  const projectId = scope.startsWith("project:") ? scope.slice(8) : null;
  const meetingId = scope.startsWith("meeting:") ? scope.slice(8) : null;
  const scoped = state.meetings.filter((m) =>
    projectId ? m.projectId === projectId : m.id === meetingId,
  );
  const valid =
    !!scope &&
    (projectId
      ? state.projects.some((p) => p.id === projectId)
      : scoped.length > 0);
  return (
    <>
      <PageHeading
        title={t("有据问答")}
        description={t("在会议之间寻找答案，也保留每一条依据。")}
      />
      <div className="content-container ask-layout">
        <section className="ask-main section">
          <form
            className="question-card"
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid || busy) return;
              if (from && to && from > to) {
                setError(t("开始日期不能晚于结束日期。"));
                return;
              }
              const request = ++generation.current;
              setBusy(true);
              setError("");
              setAnswer(null);
              void run({ op: "ask", question, projectId, meetingId, from, to })
                .then((result) => {
                  if (request === generation.current) setAnswer(result);
                })
                .catch((e) => {
                  if (request === generation.current) setError(e.message);
                })
                .finally(() => {
                  if (request === generation.current) setBusy(false);
                });
            }}
          >
            <label htmlFor="meeting-question">{t("向会议提问")}</label>
            <textarea
              id="meeting-question"
              aria-label={t("你的问题")}
              required
              maxLength={4000}
              rows={4}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                resetAnswer();
              }}
              placeholder={t("例如：这个项目的技术方案发生过哪些变化？")}
            />
            <div className="question-footer">
              <span className="meta">{t("回答保留时间戳与原文依据")}</span>
              <button className="primary" disabled={busy || !valid}>
                {busy ? t("正在检索与核对…") : t("✧ 查询原文并回答")}
              </button>
            </div>
          </form>
          {error && (
            <p role="alert" className="warning">
              {localizeMessage(error ?? "")}
            </p>
          )}
          <div aria-live="polite">
            {answer ? (
              <article className="answer">
                <h2>{t("回答")}</h2>
                <p>{answer.text}</p>
                {refs(answer.evidence)}
                <small>{localizeMessage(answer.coverage ?? "")}</small>
              </article>
            ) : (
              <div className="empty-state">
                <h2>{busy ? t("正在核对会议依据") : t("不止找到一句话")}</h2>
                <p>
                  {busy
                    ? t("检索和回答使用你配置的服务，请稍候。")
                    : t(
                        "连同发言人、时间和上下文一起查看，分清已经做出的决定与仍在讨论的建议。",
                      )}
                </p>
              </div>
            )}
          </div>
        </section>
        <aside className="ask-scope">
          <h2>{t("检索范围")}</h2>
          <div className="scope-fields">
            <label>
              {t("会议范围")}
              <select
                aria-label={t("会议范围")}
                value={valid ? scope : ""}
                onChange={(e) => {
                  setScope(e.target.value);
                  resetAnswer();
                }}
              >
                <option value="" disabled>
                  {t("选择会议或项目")}
                </option>
                <optgroup label={t("项目")}>
                  {state.projects.map((p) => (
                    <option key={p.id} value={`project:${p.id}`}>
                      {t("项目：")}
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("会议")}>
                  {state.meetings.map((m) => (
                    <option key={m.id} value={`meeting:${m.id}`}>
                      {m.title}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label>
              {t("开始日期")}
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  resetAnswer();
                }}
              />
            </label>
            <label>
              {t("结束日期")}
              <input
                type="date"
                min={from || undefined}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  resetAnswer();
                }}
              />
            </label>
          </div>
          <p className="muted">
            {t("当前范围包含")} {scoped.length}{" "}
            {t("场会议。日期按会议发生时间筛选；实际检索覆盖范围随回答展示。")}
          </p>
          {!state.meetings.length && (
            <p className="muted">
              {t("先创建会议并保存转录，即可开始有据问答。")}
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
