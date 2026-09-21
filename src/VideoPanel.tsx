import { t } from "./i18n";
import { useEffect, useState } from "react";
import type { Meeting, Request, VisualFrame } from "../shared/types";

const time = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
export function VideoPanel({
  meeting,
  focus,
  current,
  busy,
  run,
  seek,
  source,
  citation,
  clearCitation,
}: {
  meeting: Meeting;
  focus: string;
  current: number;
  busy: boolean;
  run: (request: Request) => Promise<any>;
  seek: (time: number) => void;
  source: (frame: VisualFrame) => string;
  citation?: VisualFrame;
  clearCitation: () => void;
}) {
  const [chosen, setChosen] = useState(focus);
  const [showExcluded, setShowExcluded] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (focus) setChosen(focus);
  }, [focus]);
  const frames = meeting.video?.frames ?? [];
  const currentFrame =
    frames.find((f) => f.id === chosen) ??
    frames.find((f) => !f.excluded) ??
    frames[0];
  const frame = citation?.id === currentFrame?.id ? citation : currentFrame;
  const historical =
    !!frame &&
    frame !== currentFrame &&
    (frame.text !== currentFrame?.text ||
      JSON.stringify(frame.parameters) !==
        JSON.stringify(currentFrame?.parameters));
  return (
    <div className="panel visual-panel">
      <div className="panel-heading">
        <h2>{t("关键画面")}</h2>
        <span>
          {frames.filter((f) => !f.excluded).length} {t("张参与分析 ·")}{" "}
          {frames.filter((f) => f.model).length} {t("张已识别")}
        </span>
      </div>
      <div className="visual-actions">
        <button
          disabled={busy}
          onClick={() =>
            void run({
              op: "job.start",
              id: meeting.id,
              kind: "visuals",
            }).catch(() => {})
          }
        >
          {meeting.video?.extracted
            ? t("识别未完成画面")
            : t("提取并识别关键画面")}
        </button>
        <button
          disabled={busy || !meeting.video?.extracted}
          onClick={() =>
            void run({ op: "video.frame.add", id: meeting.id, time: current })
              .then((f) => setChosen(f.id))
              .catch(() => {})
          }
        >
          {t("＋ 补充当前画面")} {time(current)}
        </button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showExcluded}
            onChange={(e) => setShowExcluded(e.target.checked)}
          />
          {t("显示已排除")}
        </label>
      </div>
      {!frame ? (
        <p className="empty">
          {t(
            "识别录像中的幻灯片、图表和演示内容。处理后可在这里核对画面，排除无关截图，再生成结合画面的纪要。",
          )}
        </p>
      ) : (
        <>
          <div className="visual-detail">
            <button
              className="frame-zoom"
              onClick={() => setZoom(true)}
              title={t("打开原始清晰截图")}
            >
              <img
                className="visual-preview"
                src={source(frame)}
                alt={`${time(frame.start)} ${frame.title}`}
              />
            </button>
            <div className="visual-observation">
              {historical && (
                <p className="warning">
                  {t("正在查看引用时的画面观察。")}
                  <button onClick={clearCitation}>{t("查看当前观察")}</button>
                </p>
              )}
              <span className="eyebrow">
                {time(frame.start)} ·{" "}
                {frame.excluded ? t("已排除") : t("画面观察")}
              </span>
              <h3>{frame.title}</h3>
              <p>
                {frame.text ||
                  (frame.model
                    ? t("未识别到相关会议内容。")
                    : t("等待识别；可点击上方按钮继续。"))}
              </p>
              {frame.uncertain && (
                <p className="warning">
                  {t("待核对：")}
                  {frame.uncertain}
                </p>
              )}
              <button onClick={() => seek(frame.start)}>
                {t("▶ 从此处播放")}
              </button>{" "}
              <button
                disabled={busy || frame.excluded || historical}
                onClick={() => {
                  clearCitation();
                  void run({
                    op: "video.frame.refresh",
                    id: meeting.id,
                    frameId: frame.id,
                  }).catch(() => {});
                }}
              >
                {t("重新识别此画面")}
              </button>{" "}
              <button
                disabled={busy || historical}
                onClick={() => {
                  clearCitation();
                  void run({
                    op: "video.frame.exclude",
                    id: meeting.id,
                    frameId: frame.id,
                    excluded: !frame.excluded,
                  }).catch(() => {});
                }}
              >
                {frame.excluded ? t("重新用于分析") : t("排除此画面")}
              </button>
              <small>
                {t(
                  "以上为模型观察。点击截图查看原图；画面展示的计划不代表会上已经确认。",
                )}
              </small>
            </div>
          </div>
          {!!frame.parameters?.length && (
            <details className="visual-parameters">
              <summary>
                {t("画面参数 ·")} {frame.parameters.length}{" "}
                {t("项，需对照原图核对")}
              </summary>
              <div className="parameter-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t("对象")}</th>
                      <th>{t("指标")}</th>
                      <th>{t("数值与单位")}</th>
                      <th>{t("条件")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {frame.parameters.map((p, i) => (
                      <tr key={i}>
                        <td>{p.object}</td>
                        <td>{p.metric}</td>
                        <td>
                          {p.value} {p.unit}
                        </td>
                        <td>{p.conditions.join("；") || t("未提取到条件")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <div className="frame-timeline" aria-label={t("关键画面时间线")}>
            {frames
              .filter((f) => showExcluded || !f.excluded)
              .map((f) => (
                <button
                  key={f.id}
                  aria-pressed={frame.id === f.id}
                  className={`frame-card ${frame.id === f.id ? "selected" : ""} ${f.excluded ? "excluded" : ""}`}
                  onClick={() => {
                    clearCitation();
                    setChosen(f.id);
                    seek(f.start);
                  }}
                >
                  <img loading="lazy" src={source(f)} alt="" />
                  <span>
                    {time(f.start)} · {f.title}
                  </span>
                </button>
              ))}
          </div>
          {zoom && (
            <div
              className="overlay"
              role="dialog"
              aria-modal="true"
              aria-label={t("原始清晰截图")}
              onKeyDown={(e) => {
                if (e.key === "Escape") setZoom(false);
              }}
            >
              <div className="frame-lightbox">
                <button autoFocus onClick={() => setZoom(false)}>
                  {t("关闭原图")}
                </button>
                <div>
                  <img src={source(frame)} alt={frame.title} />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
