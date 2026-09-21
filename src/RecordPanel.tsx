import { localizeMessage, t } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import type { Bridge, CaptureSource } from "../shared/types";
export interface RecordOptions {
  screen: boolean;
  sourceId: string;
  sourceName: string;
  deviceId: string;
  microphone: boolean;
  system: boolean;
}

export function RecordPanel({
  api,
  onPrepare,
  reset,
  levels,
  start,
}: {
  api: Bridge;
  onPrepare: (options: RecordOptions) => Promise<MediaStream | undefined>;
  reset: () => Promise<void>;
  levels: number[];
  start: () => Promise<void>;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [options, setOptions] = useState<RecordOptions>({
    screen: false,
    sourceId: "",
    sourceName: "",
    deviceId: "",
    microphone: true,
    system: true,
  });
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState<MediaStream>();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    void navigator.mediaDevices
      .enumerateDevices()
      .then((d) => setDevices(d.filter((d) => d.kind === "audioinput")))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (video.current) {
      video.current.srcObject = preview ?? null;
      if (preview) void video.current.play().catch(() => {});
    }
  }, [preview]);
  const update = (changes: Partial<RecordOptions>) =>
    setOptions((o) => ({ ...o, ...changes }));
  const loadSources = async () => {
    setBusy(true);
    setError("");
    try {
      setSources(await api.invoke({ op: "screen.sources" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2>{options.screen ? t("准备录屏") : t("准备录音")}</h2>
      <label>
        {t("录制内容")}
        <select
          aria-label={t("录制内容")}
          disabled={ready || busy}
          value={options.screen ? "screen" : "audio"}
          onChange={(e) => {
            const screen = e.target.value === "screen";
            update({ screen, microphone: true });
            setError("");
            if (screen) void loadSources();
          }}
        >
          <option value="audio">{t("仅录音")}</option>
          <option value="screen">{t("录音 + 屏幕")}</option>
        </select>
      </label>
      {options.screen && (
        <>
          <div className="capture-source-heading">
            <strong>{t("选择窗口或显示器")}</strong>
            <button disabled={ready || busy} onClick={() => void loadSources()}>
              {t("刷新来源")}
            </button>
          </div>
          {!ready && (
            <div className="capture-sources">
              {sources.map((source) => (
                <button
                  className={`capture-source ${options.sourceId === source.id ? "selected" : ""}`}
                  key={source.id}
                  aria-pressed={options.sourceId === source.id}
                  disabled={busy}
                  onClick={() =>
                    update({ sourceId: source.id, sourceName: source.name })
                  }
                >
                  <img src={source.thumbnail} alt="" />
                  <span>
                    {source.kind === "screen" ? t("显示器") : t("窗口")} ·{" "}
                    {source.name}
                  </span>
                </button>
              ))}
            </div>
          )}
          {options.sourceName && (
            <p className="muted">
              {t("录制来源：")}
              {options.sourceName}
            </p>
          )}
          {preview && (
            <video
              className="capture-preview"
              ref={video}
              muted
              playsInline
              aria-label={t("录屏预览")}
            />
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={options.microphone}
              disabled={ready || busy}
              onChange={(e) => update({ microphone: e.target.checked })}
            />
            {t("录制麦克风")}
          </label>
        </>
      )}
      {options.microphone && (
        <label>
          {t("麦克风")}
          <select
            disabled={ready || busy}
            value={options.deviceId}
            onChange={(e) => update({ deviceId: e.target.value })}
          >
            <option value="">{t("系统默认麦克风")}</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || t("麦克风 {p0}", { p0: i + 1 })}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={options.system}
          disabled={ready || busy}
          onChange={(e) => update({ system: e.target.checked })}
        />
        {t("同时录制系统声音")}
      </label>
      {options.screen && (
        <p className="muted">
          {t(
            "系统声音会包含电脑播放的其他声音，选择窗口不会隔离该窗口的声音。录像保存在本机，生成图文分析时才按服务设置发送画面。",
          )}
        </p>
      )}
      {[t("麦克风"), t("系统声音")].map((name, i) => (
        <div className="level" key={name}>
          <span>{name}</span>
          <meter min={0} max={1} value={levels[i]} />
          <small>{Math.round(levels[i] * 100)}%</small>
        </div>
      ))}
      {error && (
        <p role="alert" className="error-text">
          {localizeMessage(error ?? "")}
        </p>
      )}
      {!ready ? (
        <button
          className="primary"
          disabled={busy || (options.screen && !options.sourceId)}
          onClick={() => {
            setBusy(true);
            setError("");
            void onPrepare(options)
              .then((stream) => {
                setPreview(stream);
                setReady(true);
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? t("正在请求设备权限…") : t("检查设备与权限")}
        </button>
      ) : (
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void start().catch((e) => {
              setError(e.message);
              setBusy(false);
              setReady(false);
              setPreview(undefined);
            });
          }}
        >
          {options.screen ? t("● 开始保存录像") : t("● 开始保存录音")}
        </button>
      )}
      <p className="muted">
        {t("请确认预览范围与声音电平。开始保存后可暂停、继续和结束录制。")}
      </p>
      {ready && (
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void reset()
              .then(() => {
                setPreview(undefined);
                setReady(false);
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {t("重新选择设备或画面")}
        </button>
      )}
    </>
  );
}
