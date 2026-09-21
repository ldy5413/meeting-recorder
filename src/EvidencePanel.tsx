import { count, uiSpeakerLabel as speakerLabel, t } from "./i18n";
import { useEffect, useState } from "react";
import type { Meeting, Segment, VisualFrame } from "../shared/types";

import { formatTime } from "./meeting-model";

export interface ResolvedCitation {
  meetingId: string;
  version?: number;
  segment?: Segment;
  frame?: VisualFrame;
  quote: string;
}

export function EvidencePanel({
  meeting,
  citation,
  focus,
  seek,
  close,
  source,
}: {
  meeting: Meeting;
  citation: ResolvedCitation | null;
  focus: string;
  seek: (seconds: number) => void;
  close: () => void;
  source: (frame: VisualFrame) => string;
}) {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const index = meeting.segments.findIndex((s) => s.id === focus);
    if (index >= 0) setOffset(Math.floor(index / 20) * 20);
  }, [focus, meeting.id]);
  useEffect(() => {
    if (offset >= meeting.segments.length)
      setOffset(
        Math.max(0, Math.floor((meeting.segments.length - 1) / 20) * 20),
      );
  }, [meeting.segments.length, offset]);
  const selected = citation?.meetingId === meeting.id ? citation : null;
  return (
    <aside className="evidence-panel" aria-label={t("原文依据")}>
      <div className="evidence-title">
        <h2>{t("原文依据")}</h2>
        <button
          className="icon-btn"
          aria-label={t("收起原文栏")}
          onClick={close}
        >
          ×
        </button>
      </div>
      <p className="evidence-caption">{t("结论有出处，细节可回查。")}</p>
      <div className="evidence-items">
        {selected && (
          <article className="evidence-item selected historical-citation">
            <div className="speaker-row">
              <strong>
                {selected.frame
                  ? t("引用的画面观察")
                  : t("引用原文 · 转录 v{p0}", { p0: selected.version })}
              </strong>
              <button
                className="time-button"
                onClick={() =>
                  seek((selected.frame ?? selected.segment)!.start)
                }
              >
                {formatTime((selected.frame ?? selected.segment)!.start)} ↗
              </button>
            </div>
            {selected.frame && (
              <img
                src={source(selected.frame)}
                alt={selected.frame.title || t("引用的历史画面")}
              />
            )}
            <p>{selected.segment?.text ?? selected.quote}</p>
            {selected.segment && (
              <small>
                {meeting.speakers[selected.segment.speaker] ||
                  speakerLabel(selected.segment.speaker)}
                {selected.version !== meeting.version
                  ? t(" · 历史版本，保留引用时的原文")
                  : t(" · 当前版本")}
              </small>
            )}
          </article>
        )}
        <p className="meta">
          {t("当前转录 v")}
          {meeting.version} · {count("segment", meeting.segments.length)}
        </p>
        {meeting.segments.slice(offset, offset + 20).map((s) => (
          <article
            className={`evidence-item ${focus === s.id ? "selected" : ""}`}
            key={s.id}
          >
            <div className="speaker-row">
              <span className="speaker-id">
                {meeting.speakers[s.speaker] || speakerLabel(s.speaker)}
              </span>
              <button
                className="time-button"
                aria-label={t("定位 {p0} 原文", { p0: formatTime(s.start) })}
                onClick={() => seek(s.start)}
              >
                {formatTime(s.start)} ↗
              </button>
            </div>
            <p>{s.text}</p>
          </article>
        ))}
        {!meeting.segments.length && (
          <p className="muted">{t("转录完成后，可在这里核对原文和时间戳。")}</p>
        )}
        {meeting.segments.length > 20 && (
          <div className="pagination">
            <button
              disabled={offset === 0}
              onClick={() => setOffset((n) => Math.max(0, n - 20))}
            >
              {t("上一页")}
            </button>
            <span>
              {Math.floor(offset / 20) + 1} /{" "}
              {Math.ceil(meeting.segments.length / 20)}
            </span>
            <button
              disabled={offset + 20 >= meeting.segments.length}
              onClick={() => setOffset((n) => n + 20)}
            >
              {t("下一页")}
            </button>
          </div>
        )}
      </div>
      <p className="evidence-footnote">
        {t("原始媒体与转录独立保留。")}
        <br />
        {t("引用保留对应的原文和画面版本。")}
      </p>
    </aside>
  );
}
