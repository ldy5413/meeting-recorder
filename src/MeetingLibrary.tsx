import { count, uiLocale, t } from "./i18n";
import { useState } from "react";
import type { Meeting, State } from "../shared/types";
import { speakerCount } from "../shared/speakers";
import { Icon, PageHeading } from "./AppShell";
import { currentMinutes } from "../shared/minutes";
import {
  durationOf,
  formatTime,
  inProject,
  meetingStatus,
} from "./meeting-model";

export function MeetingLibrary({
  state,
  project,
  query,
  setQuery,
  open,
  create,
  importMedia,
  tracking,
  trash,
}: {
  state: State;
  project: string;
  query: string;
  setQuery: (s: string) => void;
  open: (m: Meeting) => void;
  create: () => void;
  importMedia: () => void;
  tracking: () => void;
  trash: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(50);
  const meetings = state.meetings
    .filter((m) => inProject(m, project))
    .sort(
      (a, b) =>
        Date.parse(b.occurredAt ?? b.created) -
        Date.parse(a.occurredAt ?? a.created),
    );
  const filtered = meetings.filter(
    (m) =>
      m.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
      (filter === "all" ||
        (filter === "ready" ? m.segments.length > 0 : !m.segments.length)),
  );
  const featured = meetings[0];
  const overview = featured
    ? currentMinutes(featured)
        ?.content.overview.map((p) => p.text)
        .join(" ")
    : undefined;
  // Group adjacent segments for large meetings without dropping their durations.
  const timeline =
    featured?.segments.reduce<number[]>((parts, segment, index) => {
      const bucket = Math.floor(
        index / Math.max(1, Math.ceil(featured.segments.length / 100)),
      );
      parts[bucket] = (parts[bucket] ?? 0) + segment.end - segment.start;
      return parts;
    }, []) ?? [];
  const title =
    project === "unassigned"
      ? t("未归入项目")
      : (state.projects.find((p) => p.id === project)?.name ?? t("会议库"));
  return (
    <>
      <PageHeading title={title} description={t("把讨论留存，把下一步理清。")}>
        <button className="btn" onClick={trash}>
          {t("最近删除")}
        </button>
        <button className="btn" onClick={importMedia}>
          <Icon name="upload" />
          {t("导入音视频")}
        </button>
      </PageHeading>
      <div className="content-container library-page">
        {featured ? (
          <section
            className="featured-meeting section"
            aria-label={t("会议速览")}
          >
            <div className="featured-main">
              <div className="featured-kicker">{t("会议速览")}</div>
              <h2>{featured.title}</h2>
              <p className="featured-excerpt">
                {overview ||
                  (featured.segments[0]
                    ? `「${featured.segments[0].text}」`
                    : t("录音与录像归入同一场会议，背景和关键词随会议保存。"))}
              </p>
              <div className="featured-footer">
                <span className="featured-meta">
                  {state.projects.find((p) => p.id === featured.projectId)
                    ?.name ?? t("未归入项目")}{" "}
                  · {count("speaker", speakerCount(featured.segments))}
                  <br />
                  {new Date(
                    featured.occurredAt ?? featured.created,
                  ).toLocaleString(uiLocale())}
                </span>
                <button
                  className="featured-open"
                  onClick={() => open(featured)}
                >
                  {t("打开会议")}
                  <span>
                    <Icon name="arrow" />
                  </span>
                </button>
              </div>
            </div>
            <div className="featured-time">
              <span className="featured-time-label">
                {featured.segments.length
                  ? t("转录覆盖时长")
                  : t("等待开始记录")}
              </span>
              <div className="featured-duration">
                {featured.segments.length
                  ? formatTime(durationOf(featured))
                  : "—"}
              </div>
              {!!featured.segments.length && (
                <>
                  <div
                    className="featured-timeline"
                    aria-label={t("{p0} 段原文的时长分布", {
                      p0: featured.segments.length,
                    })}
                  >
                    {timeline.map((duration, index) => (
                      <span
                        key={index}
                        style={{ flex: Math.max(0.1, duration) }}
                      />
                    ))}
                  </div>
                  <div className="featured-scale">
                    <span>00:00</span>
                    <span>{formatTime(durationOf(featured))}</span>
                  </div>
                </>
              )}
              <span className="featured-segments">
                {featured.segments.length
                  ? t("{p0} 段原文 · 均可定位核对", {
                      p0: featured.segments.length,
                    })
                  : t("开始录音或导入已有资料")}
              </span>
            </div>
          </section>
        ) : (
          <section className="empty-state library-empty">
            <Icon name="note" />
            <h2>
              <span>{t("从一次会议，")}</span>
              {t("到持续推进的项目。")}
            </h2>
            <p>
              {t("录下讨论，校对原文，整理决策与待办。")}
              <br />
              {t("每一项结论，都能回到它的出处。")}
            </p>
            <button className="primary" onClick={create}>
              {t("＋ 创建第一场会议")}
            </button>
          </section>
        )}
        <section className="section library-list" aria-label={t("会议列表")}>
          <div className="library-tools">
            <div
              className="segmented"
              role="group"
              aria-label={t("会议状态筛选")}
            >
              {[
                ["all", t("全部会议")],
                ["ready", t("已有转录")],
                ["empty", t("待处理")],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "active" : ""}
                  aria-pressed={filter === value}
                  onClick={() => {
                    setFilter(value);
                    setLimit(50);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="search-field">
              <Icon name="search" />
              <input
                id="library-search"
                aria-label={t("搜索会议")}
                placeholder={t("搜索会议名称")}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(50);
                }}
              />
            </div>
          </div>
          <div className="log-list">
            <div className="log-heading">
              <span>{t("会议名称")}</span>
              <span>{t("所属项目")}</span>
              <span>{t("处理状态")}</span>
              <span>{t("时长")}</span>
            </div>
            {filtered.slice(0, limit).map((m) => {
              const status = meetingStatus(m, state.jobs);
              return (
                <button
                  className="meeting-row"
                  key={m.id}
                  onClick={() => open(m)}
                >
                  <span className="meeting-name">
                    <span className="file-icon">
                      <Icon name="note" />
                    </span>
                    <span>
                      <strong>{m.title}</strong>
                      <small>
                        {new Date(m.occurredAt ?? m.created).toLocaleDateString(
                          uiLocale(),
                        )}{" "}
                        · {count("segment", m.segments.length)}
                      </small>
                    </span>
                  </span>
                  <span className="meeting-project">
                    {state.projects.find((p) => p.id === m.projectId)?.name ??
                      t("未归入项目")}
                  </span>
                  <span className={`status ${status.tone}`}>{status.text}</span>
                  <span className="num meeting-duration">
                    {durationOf(m)
                      ? formatTime(durationOf(m))
                      : m.video?.duration
                        ? formatTime(m.video.duration)
                        : "—"}
                  </span>
                </button>
              );
            })}
          </div>
          {!filtered.length && !!meetings.length && (
            <div className="empty-state">
              <h3>{t("没有匹配的会议")}</h3>
              <p>{t("试试其他名称或处理状态。")}</p>
              <button
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                {t("清除筛选")}
              </button>
            </div>
          )}
          {filtered.length > limit && (
            <button onClick={() => setLimit((n) => n + 50)}>
              {t("加载更多会议")}
            </button>
          )}
          <footer className="library-footer">
            <span>{count("meeting", filtered.length)}</span>
            <span>
              {t("本地会议库 ·")} {count("project", state.projects.length)}
            </span>
          </footer>
        </section>
        <section className="library-onboarding section">
          <div className="row">
            <span className="onboarding-num">01 /</span>
            <div>
              <h3>{t("把资料放在一起")}</h3>
              <p>{t("录音与录像归入同一场会议，背景和关键词随会议保存。")}</p>
              <button className="btn btn-ghost" onClick={create}>
                {t("录制新会议")}
              </button>
            </div>
          </div>
          <div className="row">
            <span className="onboarding-num">02 /</span>
            <div>
              <h3>{t("把结论落实到项目")}</h3>
              <p>{t("核对后确认待办和决策，持续记录负责人、状态与变化。")}</p>
              <button className="btn btn-ghost" onClick={tracking}>
                {t("查看项目追踪")}
                <Icon name="arrow" />
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
