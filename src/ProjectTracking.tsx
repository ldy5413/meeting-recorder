import { count, uiLocale, t } from "./i18n";
import { useState, type ReactNode } from "react";
import type { Evidence, State, VisualFrame } from "../shared/types";
import { PageHeading } from "./AppShell";
import { pendingProposals } from "./meeting-model";

export interface ProposalSelection {
  meetingId: string;
  analysisId: string;
  index: number;
}
export function ProjectTracking({
  state,
  project,
  setProject,
  refs,
  review,
  defaults,
}: {
  state: State;
  project: string;
  setProject: (id: string) => void;
  refs: (e: Evidence[], frames?: VisualFrame[]) => ReactNode;
  review: (p: ProposalSelection) => void;
  defaults: () => void;
}) {
  const [filter, setFilter] = useState("pending");
  const pending = pendingProposals(state, project);
  const records = state.records.filter(
    (r) => !project || r.projectId === project,
  );
  const visible = records.filter((r) => filter === "all" || r.kind === filter);
  const meetings = state.meetings.filter(
    (m) => m.projectId && (!project || m.projectId === project),
  );
  return (
    <>
      <PageHeading
        title={t("项目追踪")}
        description={t("让确认过的行动和决策，拥有清楚的来路与进展。")}
      >
        <button onClick={defaults}>{t("项目默认设置")}</button>
      </PageHeading>
      <div className="content-container tracking-page">
        <section className="project-overview section">
          <div className="project-stat">
            <label>
              {t("当前项目")}
              <select
                aria-label={t("追踪项目")}
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">{t("全部项目")}</option>
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="meta">{count("meeting", meetings.length)}</p>
          </div>
          <div className="project-stat">
            <span className="meta">{t("待确认建议")}</span>
            <div className="stat-value">
              {String(pending.length).padStart(2, "0")}
              <span>{t("条")}</span>
            </div>
          </div>
          <div className="project-stat">
            <span className="meta">{t("正式项目记录")}</span>
            <div className="stat-value">
              {String(records.length).padStart(2, "0")}
              <span>{t("条")}</span>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="library-tools">
            <div
              className="segmented"
              role="group"
              aria-label={t("项目记录筛选")}
            >
              {[
                ["pending", t("待确认")],
                ["all", t("全部记录")],
                ["todo", t("待办")],
                ["decision", t("决策")],
              ].map(([value, text]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {text}
                </button>
              ))}
            </div>
            <span className="meta">
              {filter === "pending" ? pending.length : visible.length} {t("条")}
            </span>
          </div>
          {(filter === "pending" ? pending.length : visible.length) ? (
            <div className="table-scroll">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>{t("事项与依据")}</th>
                    <th>{t("负责人 / 期限")}</th>
                    <th>{t("状态")}</th>
                    <th>{t("操作")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filter === "pending"
                    ? pending.map(({ meeting, analysis, claim, index }) => (
                        <tr key={`${meeting.id}-${analysis.id}-${index}`}>
                          <td>
                            <strong>{claim.text}</strong>
                            <span className="badge">
                              {claim.kind === "todo" ? t("待办") : t("决策")}
                            </span>
                            <p className="meta">{meeting.title}</p>
                            {refs(claim.evidence, analysis.visual?.frames)}
                          </td>
                          <td>
                            {claim.owner || t("未明确")}
                            <p className="meta">
                              {claim.due || t("期限未明确")}
                            </p>
                          </td>
                          <td>
                            <span className="status pending">
                              {t("待确认")}
                            </span>
                          </td>
                          <td>
                            <button
                              onClick={() =>
                                review({
                                  meetingId: meeting.id,
                                  analysisId: analysis.id,
                                  index,
                                })
                              }
                            >
                              {t("核对确认")}
                            </button>
                          </td>
                        </tr>
                      ))
                    : visible.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.text}</strong>
                            <span className="badge">
                              {r.kind === "todo" ? t("待办") : t("决策")}
                            </span>
                            {refs(r.evidence)}
                            <details className="record-details">
                              <summary>
                                {t("查看详情 · 变更历史")} {r.history.length}
                              </summary>
                              <p>
                                {t("记录版本 v")}
                                {r.version} ·{" "}
                                {
                                  state.projects.find(
                                    (p) => p.id === r.projectId,
                                  )?.name
                                }
                              </p>
                              {r.history.map((h, i) => (
                                <div className="history" key={i}>
                                  <small>
                                    {new Date(h.at).toLocaleString(uiLocale())}{" "}
                                    ·{" "}
                                    {{
                                      new: t("新增"),
                                      continue: t("延续 / 更新"),
                                      complete: t("已完成"),
                                      replace: t("替代 / 推翻"),
                                    }[h.change] ?? h.change}
                                  </small>
                                  <p>{h.text}</p>
                                  {refs(h.evidence)}
                                </div>
                              ))}
                            </details>
                          </td>
                          <td>
                            {r.owner || t("未明确")}
                            <p className="meta">{r.due || t("期限未明确")}</p>
                          </td>
                          <td>
                            <span className="status ready">
                              {
                                {
                                  open: t("进行中"),
                                  complete: t("已完成"),
                                  replaced: t("已被推翻"),
                                }[r.status]
                              }
                            </span>
                          </td>
                          <td>
                            <span className="meta">{t("已确认 · 只读")}</span>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h2>
                {filter === "pending"
                  ? t("暂无待确认建议")
                  : t("这里还没有确认的记录")}
              </h2>
              <p>
                {t("在会议纪要中核对待办和决策，确认后即可持续追踪。")}
                <br />
                {t("未归入项目的会议需先设置所属项目。")}
              </p>
            </div>
          )}
          <p className="tracking-note">
            {t(
              "建议经过人工确认后才成为正式记录。负责人和期限按会议依据保留，未明确的信息如实展示。",
            )}
          </p>
        </section>
      </div>
    </>
  );
}
