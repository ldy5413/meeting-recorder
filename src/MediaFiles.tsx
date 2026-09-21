import { localizeMessage, t } from "./i18n";
import { useEffect, useState } from "react";
import type { Bridge, MediaLocation } from "../shared/types";

export function MediaFiles({ id, bridge }: { id: string; bridge: Bridge }) {
  const [location, setLocation] = useState<MediaLocation | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void bridge
      .invoke({ op: "media.location", id })
      .then((value: MediaLocation) => {
        if (active) setLocation(value);
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [id, bridge]);
  return (
    <>
      <h2>{t("原始录音／录像文件")}</h2>
      <p className="muted">
        {t(
          "这里显示会议库实际保存的媒体文件。导入的文件在会议库中保留副本；纯录音还可能包含独立的麦克风和系统声音音轨。",
        )}
      </p>
      {!location && !message && <p>{t("正在读取文件位置…")}</p>}
      {location && (
        <>
          <label>
            {t("媒体保存目录")}
            <input
              readOnly
              value={location.directory}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          {location.files.map((file) => (
            <div className="media-file" key={file.kind}>
              <label>
                {localizeMessage(file.label)}
                {t("路径")}
                <input
                  readOnly
                  value={file.path}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <div className="media-file-actions">
                <small>
                  {file.exists
                    ? `${((file.bytes ?? 0) / 1024 ** 2).toFixed(1)} MiB`
                    : t("文件未找到，可能已被移动或删除")}
                </small>
                <button
                  disabled={!file.exists}
                  onClick={() => {
                    void bridge
                      .invoke({ op: "media.reveal", id, kind: file.kind })
                      .then(() => setMessage(t("已请求在文件夹中显示文件")))
                      .catch((error) => setMessage(error.message));
                  }}
                >
                  {t("在文件夹中显示")}
                </button>
              </div>
            </div>
          ))}
          {!location.files.length && <p>{t("此会议尚未保存录音或录像。")}</p>}
        </>
      )}
      <p role="status">{localizeMessage(message ?? "")}</p>
    </>
  );
}
