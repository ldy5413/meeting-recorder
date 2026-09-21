import {
  count,
  templateName,
  languageName,
  uiSpeakerLabel as speakerLabel,
  t,
  setUiLanguage,
  useUiLanguage,
  localizeMessage,
  uiLocale,
} from "./i18n";
import {
  ContextEditor,
  TemplateManager,
  ProjectDefaults,
} from "./Configuration";
import { analysisMarkdown, contextOf } from "../shared/analysis";
import { LanguageSettings } from "./LanguageSettings";
import { labelsFor } from "../shared/language";
import { speakerCount, speakerIds } from "../shared/speakers";
import type { AnalysisSection, AnalysisTemplate } from "../shared/types";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Bridge,
  State,
  Meeting,
  Request,
  Evidence,
  Settings,
  VisualFrame,
} from "../shared/types";
import { Recorder } from "./recorder";
import { ScreenRecorder } from "./screen-recorder";
import { RecordPanel } from "./RecordPanel";
import { VideoPanel } from "./VideoPanel";
import { MediaFiles } from "./MediaFiles";
import { Sidebar, WorkspaceHeader, PageHeading, type Page } from "./AppShell";
import { MeetingLibrary } from "./MeetingLibrary";
import { EvidencePanel, type ResolvedCitation } from "./EvidencePanel";
import { ProjectTracking, type ProposalSelection } from "./ProjectTracking";
import { MeetingAsk } from "./MeetingAsk";
import { MinutesPanel } from "./MinutesPanel";
import { meetingStatus } from "./meeting-model";
import { readPreferences, savePreferences } from "./reading-preferences";
import "./design-system.css";
import "./style.css";
declare global {
  interface Window {
    meeting: Bridge;
  }
}
const browserBridge =
  !window.meeting &&
  location.protocol === "http:" &&
  location.hostname === "127.0.0.1";
const api: Bridge = window.meeting || {
  invoke: async (request) => {
    if (!browserBridge)
      throw new Error(t("请从桌面应用打开，或显式启用本地开发浏览器桥接"));
    const response = await fetch("/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok)
      throw new Error(t("开发连接失败 ({p0})", { p0: response.status }));
    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
};
const labels: Record<string, string> = {
  get synthesize() {
    return t("全场提炼");
  },
  get summary() {
    return t("会议纪要");
  },
  get topic() {
    return t("议题");
  },
  get decision() {
    return t("决策");
  },
  get suggestion() {
    return t("讨论建议");
  },
  get todo() {
    return t("待办");
  },
  get new() {
    return t("新增");
  },
  get continue() {
    return t("延续 / 更新");
  },
  get complete() {
    return t("已完成");
  },
  get replace() {
    return t("替代 / 推翻");
  },
  get open() {
    return t("进行中");
  },
  get replaced() {
    return t("已被推翻");
  },
  get queued() {
    return t("排队中");
  },
  get running() {
    return t("处理中");
  },
  get failed() {
    return t("失败");
  },
  get cancelled() {
    return t("已取消");
  },
  get transcribe() {
    return t("转录");
  },
  get speakers() {
    return t("统一说话人");
  },
  get analyze() {
    return t("分析");
  },
  get visuals() {
    return t("画面识别");
  },
  get ready() {
    return t("已保存");
  },
  get empty() {
    return t("待录音");
  },
  get recording() {
    return t("录制中");
  },
  get interrupted() {
    return t("录制曾中断");
  },
};
const time = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
function App() {
  useUiLanguage();
  const [state, setState] = useState<State | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [project, setProject] = useState(""),
    [filter, setFilter] = useState(""),
    [tab, setTab] = useState("transcript"),
    [modal, setModal] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [recordState, setRecordState] = useState("idle"),
    [levels, setLevels] = useState([0, 0]),
    [elapsed, setElapsed] = useState(0),
    [current, setCurrent] = useState(0),
    [focus, setFocus] = useState("");
  const [page, setPage] = useState<Page>("library");
  const [menuOpen, setMenuOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [citation, setCitation] = useState<ResolvedCitation | null>(null);
  const [proposal, setProposal] = useState<ProposalSelection | null>(null);
  const [settingsTab, setSettingsTab] = useState("services");
  const [readingPreferences, setReadingPreferences] = useState(readPreferences);
  const { comfortable, defaultEvidence } = readingPreferences;
  const updateReadingPreferences = (
    changes: Partial<typeof readingPreferences>,
  ) => {
    const value = { ...readingPreferences, ...changes };
    try {
      savePreferences(value);
      setReadingPreferences(value);
    } catch {
      setError(t("阅读偏好无法保存，请检查本机存储是否可写。"));
    }
  };
  const [createIntent, setCreateIntent] = useState<"meeting" | "import">(
    "meeting",
  );
  useEffect(() => {
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  }, [page, selected, settingsTab]);
  const refreshGeneration = useRef(0);
  const navigationGeneration = useRef(0);
  const pendingRequests = useRef(0);
  const navigate = (next: Page) => {
    navigationGeneration.current++;
    setPage(next);
    setMenuOpen(false);
    setError("");
    setNotice("");
    if (next === "tracking" && project === "unassigned") setProject("");
  };
  const openMeeting = (m: Meeting) => {
    navigate("meeting");
    setSelected(m.id);
    setTab(m.analyses.length ? "analysis" : "transcript");
    setFocus("");
    setCitation(null);
    setFrameCitation(null);
    setSeekRequest(null);
    setEvidenceOpen(defaultEvidence);
  };
  const openCreate = (intent: "meeting" | "import" = "meeting") => {
    setError("");
    setCreateIntent(intent);
    setModal("create");
  };
  const review = (selection: ProposalSelection) => {
    setProposal(selection);
    setError("");
    setModal("proposal");
  };
  const searchLibrary = () => {
    navigate("library");
    requestAnimationFrame(() =>
      document.getElementById("library-search")?.focus(),
    );
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        !modal &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        searchLibrary();
      }
      if (!modal && event.key === "Escape") {
        setMenuOpen(false);
        if (page === "settings") navigate("library");
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [modal, page]);
  const [useVisuals, setUseVisuals] = useState(true);
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [captureName, setCaptureName] = useState("");
  const [recordTransition, setRecordTransition] = useState(false);
  const [frameCitation, setFrameCitation] = useState<{
    meetingId: string;
    frame: VisualFrame;
  } | null>(null);
  const [seekRequest, setSeekRequest] = useState<{
    meetingId: string;
    seconds: number;
  } | null>(null);
  const player = useRef<HTMLAudioElement | HTMLVideoElement>(null),
    modalOpener = useRef<HTMLElement | null>(null),
    recorder = useRef<Recorder | ScreenRecorder | null>(null),
    recordingMeeting = useRef<string | null>(null);
  const refresh = async () => {
    const generation = ++refreshGeneration.current;
    const s = (await api.invoke({ op: "state" })) as State;
    if (generation === refreshGeneration.current) {
      setUiLanguage(s.settings.uiLanguage, s.systemLocale);
      setState(s);
    }
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 2500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (recordState !== "recording") return;
    const timer = setInterval(
      () =>
        setElapsed((n) =>
          recorder.current instanceof ScreenRecorder
            ? recorder.current.elapsedSeconds
            : n + 1,
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [recordState]);
  useEffect(() => {
    if (!modal) return;
    const previous =
      modalOpener.current ?? (document.activeElement as HTMLElement | null);
    const dialog = document.querySelector<HTMLElement>(".modal");
    dialog?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dialog?.querySelector<HTMLButtonElement>(".close")?.click();
      } else if (
        event.key === "Tab" &&
        !dialog?.contains(document.activeElement)
      ) {
        event.preventDefault();
        dialog?.querySelector<HTMLButtonElement>(".close")?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus();
      });
    };
  }, [modal]);
  const meeting = state?.meetings.find((m) => m.id === selected) ?? null;
  const isVideo =
    !!meeting?.video ||
    (meeting?.mediaType !== "audio" &&
      /\.(mp4|webm)$/i.test(meeting?.audio ?? ""));
  const meetingBusy =
    busy ||
    !!meeting?.deletedAt ||
    !!state?.jobs.some(
      (j) =>
        j.meetingId === selected && ["running", "queued"].includes(j.status),
    );
  useEffect(() => {
    setVideoExpanded(false);
    setCurrent(
      seekRequest && seekRequest.meetingId === meeting?.id
        ? seekRequest.seconds
        : 0,
    );
  }, [meeting?.id]);
  useEffect(() => {
    if (state && selected && !state.meetings.some((m) => m.id === selected)) {
      setSelected(null);
      setCitation(null);
      setFrameCitation(null);
      setSeekRequest(null);
      setFocus("");
      setPage("library");
    }
    if (
      state &&
      project &&
      project !== "unassigned" &&
      !state.projects.some((p) => p.id === project)
    )
      setProject("");
  }, [state, selected, project]);
  useEffect(() => {
    const media = player.current;
    if (!seekRequest || seekRequest.meetingId !== meeting?.id) return;
    if (!media) {
      setCurrent(seekRequest.seconds);
      setSeekRequest(null);
      return;
    }
    const apply = () => {
      media.currentTime = seekRequest.seconds;
      setCurrent(seekRequest.seconds);
      void media.play().catch(() => {});
      setSeekRequest(null);
    };
    if (media.readyState >= 1) apply();
    else media.addEventListener("loadedmetadata", apply, { once: true });
    return () => media.removeEventListener("loadedmetadata", apply);
  }, [seekRequest, meeting?.id]);
  const seek = (seconds: number) => {
    if (meeting) {
      setCurrent(seconds);
      const segment = meeting.segments.find(
        (s) => s.start <= seconds && s.end > seconds,
      );
      if (segment) setFocus(segment.id);
      if (meeting.audio) setSeekRequest({ meetingId: meeting.id, seconds });
    }
  };
  const run = async (r: Request) => {
    const generation = navigationGeneration.current;
    setError("");
    pendingRequests.current++;
    setBusy(true);
    try {
      const result = await api.invoke(r);
      await refresh();
      if (r.op === "restore" && result) {
        navigationGeneration.current++;
        setSelected(null);
        setProject("");
        setFilter("");
        setCitation(null);
        setFrameCitation(null);
        setSeekRequest(null);
        setFocus("");
        setPage("library");
        setModal(null);
      }
      return result;
    } catch (e) {
      if (generation === navigationGeneration.current)
        setError((e as Error).message);
      throw e;
    } finally {
      setBusy(--pendingRequests.current > 0);
    }
  };
  const act = (r: Request) => void run(r).catch(() => {});
  const retryJob = async (id: string) => {
    setNotice(t("正在重新提交任务…"));
    try {
      await run({ op: "job.retry", id });
      setNotice(
        t("已重新提交任务；处理状态或失败原因会显示在下方任务卡片中。"),
      );
    } catch {
      setNotice("");
    }
  };
  const jump = async (e: Evidence, snapshot?: VisualFrame) => {
    const generation = ++navigationGeneration.current;
    let resolved;
    try {
      resolved = await api.invoke({ op: "evidence.resolve", evidence: e });
    } catch (error) {
      if (generation === navigationGeneration.current)
        setError((error as Error).message);
      return;
    }
    if (generation !== navigationGeneration.current) return;
    const s = snapshot ?? resolved.frame ?? resolved.segment;
    setCurrent(s.start);
    setCitation({
      ...resolved,
      frame: snapshot ?? resolved.frame,
      quote: e.quote,
    });
    setPage("meeting");
    setEvidenceOpen(true);
    setModal(null);
    setFrameCitation(
      resolved.frame
        ? { meetingId: resolved.meetingId, frame: snapshot ?? resolved.frame }
        : null,
    );
    setSelected(resolved.meetingId);
    setNotice(
      resolved.frame
        ? t("画面 {p0} 的模型观察：{p1}", { p0: time(s.start), p1: e.quote })
        : t("引用来自转录 v{p0}：{p1}", { p0: resolved.version, p1: e.quote }),
    );
    setTab(
      resolved.frame
        ? "visuals"
        : page === "meeting" && selected === resolved.meetingId
          ? tab
          : "analysis",
    );
    setFocus(s.id);
    setSeekRequest({ meetingId: resolved.meetingId, seconds: s.start });
    setTimeout(() => {
      document
        .getElementById(s.id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
  };
  const refs = (evidence: Evidence[], frames?: VisualFrame[]) => (
    <div className="evidence">
      {evidence.map((e, i) => (
        <button
          key={`${e.frameId ?? e.segmentId}-${i}`}
          onClick={() =>
            void jump(
              e,
              frames?.find((f) => f.id === e.frameId),
            )
          }
          title={e.quote}
        >
          ↗ {e.frameId ? t("画面") : t("原文")} {i + 1}
        </button>
      ))}
    </div>
  );
  const stop = async () => {
    setRecordState("saving");
    try {
      await recorder.current?.stop();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      recorder.current = null;
      setRecordState("idle");
      await refresh();
    }
  };
  useEffect(() => {
    const listener = () => {
      if (recorder.current) void stop();
    };
    window.addEventListener("meeting-stop-request", listener);
    return () => window.removeEventListener("meeting-stop-request", listener);
  }, []);
  useEffect(() => {
    const active = state?.meetings.find(
      (m) => m.id === recordingMeeting.current,
    );
    if (
      recorder.current instanceof ScreenRecorder &&
      active?.capture &&
      active.capture.status !== "recording" &&
      ["recording", "paused"].includes(recordState)
    )
      void stop();
  }, [state, recordState]);
  if (!state)
    return <div className="loading">{error || t("正在打开本地会议库…")}</div>;
  const activeState = {
    ...state,
    meetings: state.meetings.filter((m) => !m.deletedAt),
  };
  const proposalMeeting = state.meetings.find(
    (m) => m.id === proposal?.meetingId,
  );
  const proposalAnalysis = proposalMeeting?.analyses.find(
    (a) => a.id === proposal?.analysisId,
  );
  const proposalClaim = proposalAnalysis?.claims[proposal?.index ?? -1];
  const proposalStale =
    !!proposalMeeting?.deletedAt ||
    !proposalMeeting?.projectId ||
    !proposalAnalysis ||
    proposalAnalysis.version !== proposalMeeting.version ||
    !!(
      proposalAnalysis.visual &&
      proposalAnalysis.visual.revision !== proposalMeeting.video?.revision
    );
  return (
    <div
      className={`app-shell ${comfortable ? "comfortable" : ""}`}
      onClickCapture={(event) => {
        if (!modal)
          modalOpener.current = (event.target as HTMLElement).closest("button");
      }}
    >
      <Sidebar
        state={activeState}
        page={page}
        project={project}
        expanded={menuOpen}
        closeMenu={() => setMenuOpen(false)}
        navigate={(next) => {
          if (next === "settings") setSettingsTab("services");
          navigate(next);
        }}
        chooseProject={(id) => {
          setProject(id);
          navigate("library");
        }}
        create={() => openCreate()}
        open={(name) => {
          if (name === "templates") {
            setSettingsTab("templates");
            navigate("settings");
          } else setModal(name);
        }}
      />
      <div className="main-shell" inert={!!modal}>
        <WorkspaceHeader
          version={state.appVersion}
          page={page}
          expanded={menuOpen}
          menu={() => setMenuOpen((v) => !v)}
          search={searchLibrary}
        />
        <main className="page-scroll" id="main-content">
          {error && !modal && (
            <div role="alert" className="alert error">
              {localizeMessage(error ?? "")}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert">
              {localizeMessage(notice ?? "")}
              <button onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {recordState !== "idle" && (
            <div className="record-banner">
              <i />{" "}
              {recordState === "saving"
                ? t("正在保存与整理")
                : recordState === "paused"
                  ? t("录制已暂停")
                  : captureName
                    ? t("正在录屏")
                    : t("正在录音")}{" "}
              · {time(elapsed)}
              {captureName && (
                <span className="capture-name" title={captureName}>
                  {captureName}
                </span>
              )}
              <button
                onClick={() => {
                  const active = state.meetings.find(
                    (m) => m.id === recordingMeeting.current,
                  );
                  if (active) openMeeting(active);
                }}
              >
                {t("返回录制会议")}
              </button>
              <button
                disabled={recordTransition || recordState === "saving"}
                onClick={() => {
                  setRecordTransition(true);
                  void (
                    recordState === "paused"
                      ? recorder.current?.resume()
                      : recorder.current?.pause()
                  )
                    ?.then(() =>
                      setRecordState(
                        recordState === "paused" ? "recording" : "paused",
                      ),
                    )
                    .catch((e) => setError(e.message))
                    .finally(() => setRecordTransition(false));
                }}
              >
                {recordState === "paused" ? t("继续") : t("暂停")}
              </button>
              <button
                disabled={recordState === "saving" || recordTransition}
                onClick={() => void stop()}
              >
                {t("■ 结束并保存")}
              </button>
            </div>
          )}
          {page === "library" && (
            <MeetingLibrary
              key={project}
              state={activeState}
              trash={() => setModal("trash")}
              project={project}
              query={filter}
              setQuery={setFilter}
              open={openMeeting}
              create={() => openCreate()}
              importMedia={() => openCreate("import")}
              tracking={() => navigate("tracking")}
            />
          )}
          {page === "tracking" && (
            <ProjectTracking
              state={activeState}
              project={project === "unassigned" ? "" : project}
              setProject={setProject}
              refs={refs}
              review={review}
              defaults={() => setModal("defaults")}
            />
          )}
          {page === "ask" && (
            <MeetingAsk
              key={`${selected}-${project}`}
              state={activeState}
              initialScope={
                project && project !== "unassigned"
                  ? `project:${project}`
                  : meeting && !meeting.deletedAt
                    ? `meeting:${meeting.id}`
                    : ""
              }
              run={run}
              refs={refs}
            />
          )}
          {page === "settings" && (
            <>
              <PageHeading
                title={t("设置")}
                description={t("让工作区适合你的记录与阅读习惯。")}
              >
                <button
                  aria-label={t("关闭")}
                  onClick={() => navigate("library")}
                >
                  {t("返回会议库")}
                </button>
              </PageHeading>
              <div className="content-container settings-layout">
                <nav className="settings-nav" aria-label={t("设置分类")}>
                  {[
                    ["services", t("服务与权限")],
                    ["templates", t("分析模板")],
                    ["language", t("语言")],
                    ["backup", t("备份与恢复")],
                    ["preferences", t("阅读偏好")],
                  ].map(([id, name]) => (
                    <button
                      key={id}
                      className={settingsTab === id ? "active" : ""}
                      aria-current={settingsTab === id ? "page" : undefined}
                      onClick={() => setSettingsTab(id)}
                    >
                      {name}
                    </button>
                  ))}
                </nav>
                <section className="settings-content section" key={settingsTab}>
                  {settingsTab === "templates" ? (
                    <TemplateManager templates={state.templates} run={run} />
                  ) : settingsTab === "language" ? (
                    <LanguageSettings state={state} run={run} />
                  ) : settingsTab === "preferences" ? (
                    <>
                      <h2>{t("阅读偏好")}</h2>
                      <p className="muted">
                        {t("应用于这台设备上的会议阅读页。")}
                      </p>
                      <label>
                        {t("纪要正文大小")}
                        <select
                          value={comfortable ? "comfortable" : "standard"}
                          onChange={(e) =>
                            updateReadingPreferences({
                              comfortable: e.target.value === "comfortable",
                            })
                          }
                        >
                          <option value="standard">{t("标准")}</option>
                          <option value="comfortable">
                            {t("舒适 · 较大正文")}
                          </option>
                        </select>
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={defaultEvidence}
                          onChange={(e) =>
                            updateReadingPreferences({
                              defaultEvidence: e.target.checked,
                            })
                          }
                        />
                        {t("默认展开原文栏")}
                      </label>
                    </>
                  ) : (
                    <SettingsPanel
                      state={state}
                      run={run}
                      notify={setNotice}
                      section={settingsTab}
                    />
                  )}
                </section>
              </div>
            </>
          )}
          {page === "meeting" && meeting && (
            <>
              <header className="meeting-header">
                <div className="eyebrow">
                  {state.projects.find((p) => p.id === meeting.projectId)
                    ?.name || t("未归入项目")}{" "}
                  <span>{t("/ 会议工作台")}</span>
                </div>
                <div className="title-row">
                  <h1>{meeting.title}</h1>
                  <button
                    disabled={!!meeting.deletedAt}
                    onClick={() => setModal("edit")}
                  >
                    {t("编辑信息")}
                  </button>
                </div>
                <div className="metadata">
                  {new Date(
                    meeting.occurredAt ?? meeting.created,
                  ).toLocaleString(uiLocale())}
                  <span>·</span>{" "}
                  {count("speaker", speakerCount(meeting.segments))}{" "}
                  <span>·</span>
                  <b>{meetingStatus(meeting, state.jobs).text}</b>
                </div>
                {meeting.deletedAt && (
                  <div className="alert">
                    <span>{t("此会议已移到最近删除，原文依据仍可查看。")}</span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        act({ op: "meeting.restore", id: meeting.id })
                      }
                    >
                      {t("恢复会议")}
                    </button>
                  </div>
                )}
                <div className="actions">
                  {!meeting.audio && !meeting.capture && (
                    <>
                      <button
                        className="primary"
                        disabled={recordState !== "idle"}
                        onClick={() => setModal("record")}
                      >
                        {t("● 开始录音 / 录屏")}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          act({ op: "audio.import", id: meeting.id })
                        }
                      >
                        {t("↥ 导入录音 / 录像")}
                      </button>
                    </>
                  )}
                  <label>
                    {t("转写语言")}
                    <select
                      aria-label={t("转写语言")}
                      disabled={busy || meetingBusy}
                      value={meeting.context?.transcriptionLanguage ?? "zh"}
                      onChange={(e) =>
                        act({
                          op: "meeting.context",
                          id: meeting.id,
                          context: {
                            ...contextOf(meeting.context),
                            transcriptionLanguage: e.target.value as
                              "zh" | "en",
                          },
                        })
                      }
                    >
                      <option value="zh">{t("中文（含中英混说）")}</option>
                      <option value="en">{t("英文")}</option>
                    </select>
                  </label>
                  <button
                    disabled={
                      busy ||
                      meetingBusy ||
                      !meeting.audio ||
                      meeting.status === "recording" ||
                      meeting.video?.hasAudio === false
                    }
                    onClick={() =>
                      act({
                        op: "job.start",
                        id: meeting.id,
                        kind: "transcribe",
                      })
                    }
                  >
                    {t("↻ 分说话人转录")}
                  </button>
                  <button
                    className={meeting.segments.length ? "primary" : ""}
                    disabled={
                      meetingBusy ||
                      (!meeting.segments.length &&
                        meeting.video?.hasAudio !== false)
                    }
                    onClick={() => {
                      setUseVisuals(!!meeting.video);
                      setModal("analyze");
                    }}
                  >
                    {t("✧ 生成分析")}
                  </button>
                  <button
                    onClick={() =>
                      act({ op: "export", id: meeting.id, format: "md" })
                    }
                  >
                    {t("导出 Markdown")}
                  </button>
                  <button
                    onClick={() =>
                      act({ op: "export", id: meeting.id, format: "srt" })
                    }
                  >
                    SRT
                  </button>
                  {isVideo && (
                    <button onClick={() => setTab("visuals")}>
                      {t("▧ 关键画面")}
                    </button>
                  )}
                  {(meeting.audio || meeting.capture) && (
                    <button onClick={() => setModal("files")}>
                      {t("原始文件")}
                    </button>
                  )}
                  {!meeting.deletedAt && (
                    <button
                      disabled={
                        meetingBusy ||
                        meeting.status === "recording" ||
                        meeting.capture?.status === "finalizing"
                      }
                      onClick={() => {
                        setError("");
                        setModal("delete-meeting");
                      }}
                    >
                      {t("删除会议")}
                    </button>
                  )}
                </div>
              </header>
              {meeting.capture && meeting.capture.status !== "recording" && (
                <div
                  className={`alert ${meeting.capture.status === "failed" ? "error" : ""}`}
                >
                  {meeting.capture.status === "finalizing"
                    ? t("正在整理录像并恢复播放时间轴，请稍候…")
                    : meeting.capture.status === "failed"
                      ? t("录像整理失败，已保留原始数据：{p0}", {
                          p0: meeting.capture.error,
                        })
                      : meeting.capture.recovered
                        ? t(
                            "已恢复可播放录像 {p0}。异常结束时尚未落盘的尾部无法恢复，请核对结束位置。",
                            { p0: time(meeting.video?.duration ?? 0) },
                          )
                        : t("录像已保存 · {p0} · {p1}", {
                            p0: time(meeting.video?.duration ?? 0),
                            p1: meeting.capture.sourceName,
                          })}
                  {meeting.capture.status === "failed" && (
                    <button
                      disabled={meetingBusy || recordState !== "idle"}
                      onClick={() =>
                        act({ op: "screen.recover", id: meeting.id })
                      }
                    >
                      {t("重试整理录像")}
                    </button>
                  )}
                </div>
              )}
              <button
                className="context-summary"
                disabled={!!meeting.deletedAt}
                onClick={() => setModal("context")}
              >
                <span className="context-summary-icon">≡</span>
                <span className="context-summary-copy">
                  <strong>{t("背景与关键词")}</strong>
                  <span>
                    {meeting.context?.background ||
                      t("添加会议背景，让术语和讨论更易理解")}
                  </span>
                </span>
                <span className="context-summary-meta">
                  {count("keyword", meeting.context?.keywords.length || 0)}
                </span>
                <span className="context-summary-edit">{t("编辑 →")}</span>
              </button>
              <div className="tabsbar">
                <div className="tabs" aria-label={t("会议内容")}>
                  {[
                    ["analysis", t("会议分析")],
                    ["transcript", t("转录与回听")],
                    ...(isVideo ? [["visuals", t("录像与画面")]] : []),
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={tab === id ? "active" : ""}
                      aria-pressed={tab === id}
                      onClick={() => setTab(id)}
                    >
                      {label}
                      {id === "transcript" && (
                        <small>{meeting.segments.length}</small>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  className="btn btn-ghost"
                  aria-expanded={evidenceOpen}
                  onClick={() => setEvidenceOpen((v) => !v)}
                >
                  {evidenceOpen ? t("收起原文栏") : t("展开原文栏")}
                </button>
              </div>
              <div
                className={`detail-body ${evidenceOpen ? "" : "evidence-closed"}`}
              >
                <div className="workspace document">
                  {state.jobs
                    .filter((j) => j.meetingId === meeting.id)
                    .slice(-3)
                    .filter((j) => j.status !== "complete")
                    .map((j) => (
                      <div className={`job ${j.status}`} key={j.id}>
                        <span>
                          {labels[j.kind]} · {labels[j.status]} ·{" "}
                          {(j.kind === "transcribe" ||
                            j.kind === "speakers") && (
                            <>
                              {j.transcription?.mode === "local"
                                ? t("内置本地转写")
                                : t("外部转写服务")}{" "}
                              ·{" "}
                            </>
                          )}
                          {localizeMessage(j.step ?? "")}
                          {j.error && (
                            <small>{localizeMessage(j.error ?? "")}</small>
                          )}
                        </span>
                        {["failed", "cancelled"].includes(j.status) && (
                          <button
                            disabled={
                              busy ||
                              state.jobs.some(
                                (x) =>
                                  x.meetingId === meeting.id &&
                                  ["queued", "running"].includes(x.status),
                              )
                            }
                            onClick={() => void retryJob(j.id)}
                          >
                            {t("重试")}
                          </button>
                        )}
                        {["queued", "running"].includes(j.status) && (
                          <button
                            onClick={() => act({ op: "job.cancel", id: j.id })}
                          >
                            {t("取消")}
                          </button>
                        )}
                      </div>
                    ))}
                  {tab === "transcript" && (
                    <Transcript
                      key={meeting.id}
                      meeting={meeting}
                      current={current}
                      busy={
                        state.jobs.some(
                          (j) =>
                            j.meetingId === meeting.id &&
                            ["queued", "running"].includes(j.status),
                        ) || !!meeting.deletedAt
                      }
                      focus={focus}
                      seeking={seekRequest?.meetingId === meeting.id}
                      run={run}
                      seek={seek}
                    />
                  )}
                  {tab === "visuals" && isVideo && (
                    <VideoPanel
                      citation={
                        frameCitation?.meetingId === meeting.id
                          ? frameCitation.frame
                          : undefined
                      }
                      clearCitation={() => setFrameCitation(null)}
                      key={meeting.id}
                      meeting={meeting}
                      focus={focus}
                      current={current}
                      busy={meetingBusy}
                      run={run}
                      seek={seek}
                      source={(frame) =>
                        browserBridge
                          ? `/frames/${frame.file}`
                          : `meeting://frames/${frame.file}`
                      }
                    />
                  )}
                  {tab === "analysis" && (
                    <AnalysisPanel
                      jobs={state.jobs}
                      templates={state.templates}
                      key={meeting.id}
                      meeting={meeting}
                      refs={refs}
                      review={review}
                      clearCitation={() => {
                        setCitation(null);
                        setFrameCitation(null);
                        setFocus("");
                      }}
                      run={run}
                    />
                  )}
                </div>
                {evidenceOpen && (
                  <EvidencePanel
                    key={meeting.id}
                    meeting={meeting}
                    citation={citation}
                    focus={focus}
                    seek={seek}
                    close={() => setEvidenceOpen(false)}
                    source={(frame) =>
                      browserBridge
                        ? `/frames/${frame.file}`
                        : `meeting://frames/${frame.file}`
                    }
                  />
                )}
              </div>
              {meeting.audio && (
                <div
                  className={`player ${isVideo ? "video-player" : ""} ${isVideo && tab === "analysis" && !videoExpanded ? "compact-player" : ""}`}
                >
                  <div className="audio-label">
                    {isVideo ? "▧" : "♫"}{" "}
                    <strong>{isVideo ? t("会议录像") : t("会议录音")}</strong>
                    <small>
                      {meeting.status === "interrupted"
                        ? t("已恢复落盘部分")
                        : t("原始媒体保存在本机")}
                    </small>
                  </div>
                  {isVideo ? (
                    <video
                      key={meeting.audio}
                      ref={(element) => {
                        player.current = element;
                      }}
                      controls
                      preload="metadata"
                      src={
                        browserBridge
                          ? `/audio/${meeting.audio}`
                          : `meeting://audio/${meeting.audio}`
                      }
                      onTimeUpdate={(e) =>
                        setCurrent(e.currentTarget.currentTime)
                      }
                    />
                  ) : (
                    <audio
                      key={meeting.audio}
                      ref={(element) => {
                        player.current = element;
                      }}
                      controls
                      src={
                        browserBridge
                          ? `/audio/${meeting.audio}`
                          : `meeting://audio/${meeting.audio}`
                      }
                      onTimeUpdate={(e) =>
                        setCurrent(e.currentTarget.currentTime)
                      }
                    />
                  )}
                  {isVideo && tab === "analysis" && (
                    <button
                      aria-expanded={videoExpanded}
                      onClick={() => setVideoExpanded((value) => !value)}
                    >
                      {videoExpanded ? t("收起录像") : t("展开录像")}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {modal && (
        <div className="overlay">
          <section
            className={`modal ${["settings", "context", "defaults", "analyze", "record", "files"].includes(modal) ? "wide" : modal === "templates" ? "template-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label={
              modal === "templates"
                ? t("分析模板")
                : modal === "settings"
                  ? t("服务与备份")
                  : modal === "defaults"
                    ? t("项目默认设置")
                    : modal === "context"
                      ? t("背景与关键词")
                      : modal === "analyze"
                        ? t("生成分析")
                        : modal === "record"
                          ? t("准备录制")
                          : modal === "files"
                            ? t("原始文件")
                            : modal === "proposal"
                              ? t("核对并确认项目记录")
                              : modal === "delete-meeting"
                                ? t("删除会议")
                                : modal === "trash"
                                  ? t("最近删除")
                                  : t("会议信息")
            }
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
                ),
              ).filter((e) => e.getClientRects().length);
              const first = items[0],
                last = items.at(-1);
              if (
                event.shiftKey &&
                (document.activeElement === first ||
                  document.activeElement === event.currentTarget)
              ) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <button
              className="close"
              aria-label={t("关闭")}
              disabled={busy}
              onClick={() => {
                if (modal === "record") void recorder.current?.dispose();
                setModal(null);
              }}
            >
              ×
            </button>
            {error && (
              <p role="alert" className="warning">
                {localizeMessage(error ?? "")}
              </p>
            )}
            {modal === "delete-meeting" && meeting && (
              <>
                <h2>{t("删除会议")}</h2>
                <p>
                  <strong>{meeting.title}</strong>
                </p>
                <p>{t("会议将移到最近删除，不再出现在会议库和问答检索中。")}</p>
                <p className="muted">
                  {t(
                    "音视频、纪要与原文保留，可随时恢复；已确认的项目记录及其依据不受影响。此操作不释放磁盘空间。",
                  )}
                </p>
                <div className="dialog-actions">
                  <button disabled={busy} onClick={() => setModal(null)}>
                    {t("取消")}
                  </button>
                  <button
                    className="primary"
                    disabled={meetingBusy}
                    onClick={() => {
                      void run({ op: "meeting.delete", id: meeting.id })
                        .then(() => {
                          setModal(null);
                          setSelected(null);
                          setCitation(null);
                          setFrameCitation(null);
                          setSeekRequest(null);
                          navigate("library");
                          setNotice(t("会议已移到最近删除"));
                        })
                        .catch(() => {});
                    }}
                  >
                    {t("确认删除")}
                  </button>
                </div>
              </>
            )}
            {modal === "trash" && (
              <>
                <h2>{t("最近删除")}</h2>
                <p className="muted">
                  {t(
                    "音视频、纪要与原文保留，可随时恢复；已确认的项目记录及其依据不受影响。此操作不释放磁盘空间。",
                  )}
                </p>
                {!state.meetings.some((m) => m.deletedAt) && (
                  <p>{t("没有已删除的会议")}</p>
                )}
                <div className="deleted-meetings">
                  {state.meetings
                    .filter((m) => m.deletedAt)
                    .sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!))
                    .map((m) => (
                      <div className="deleted-meeting" key={m.id}>
                        <div>
                          <strong>{m.title}</strong>
                          <small>
                            {t("删除时间")} ·{" "}
                            {new Date(m.deletedAt!).toLocaleString(uiLocale())}
                          </small>
                        </div>
                        <button
                          disabled={busy}
                          onClick={() =>
                            act({ op: "meeting.restore", id: m.id })
                          }
                        >
                          {t("恢复会议")}
                        </button>
                      </div>
                    ))}
                </div>
              </>
            )}
            {modal === "proposal" &&
              proposal &&
              proposalClaim &&
              proposalAnalysis &&
              proposalMeeting && (
                <>
                  <h2>{t("核对并确认项目记录")}</h2>
                  <p className="muted">
                    {proposalMeeting.title} {t("· 转录 v")}
                    {proposalAnalysis.version}
                  </p>
                  <h3>{proposalClaim.text}</h3>
                  <p>
                    {t("负责人：")}
                    {proposalClaim.owner || t("未明确")}　{t("期限：")}
                    {proposalClaim.due || t("未明确")}
                  </p>
                  <p className="muted">
                    {t("确认后加入「")}
                    {state.projects.find(
                      (p) => p.id === proposalMeeting.projectId,
                    )?.name ?? t("未归入项目")}
                    {t("」。负责人和期限保留分析中的实际字段。")}
                  </p>
                  {proposalClaim.evidence.map((e, i) => (
                    <blockquote key={i}>{e.quote}</blockquote>
                  ))}
                  {refs(
                    proposalClaim.evidence,
                    proposalAnalysis.visual?.frames,
                  )}
                  {proposalStale && (
                    <p className="warning">
                      {t("原文或画面已变化，请重新分析后确认。")}
                    </p>
                  )}
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      proposalStale ||
                      proposalAnalysis.acceptedIndices?.includes(proposal.index)
                    }
                    onClick={() => {
                      void run({
                        op: "proposal.accept",
                        id: proposal.meetingId,
                        analysisId: proposal.analysisId,
                        index: proposal.index,
                      })
                        .then(() => {
                          setModal(null);
                          setProposal(null);
                        })
                        .catch(() => {});
                    }}
                  >
                    {t("确认加入项目")}
                  </button>
                </>
              )}
            {modal === "files" && meeting && (
              <MediaFiles key={meeting.id} id={meeting.id} bridge={api} />
            )}
            {(modal === "create" || modal === "edit") && (
              <MeetingForm
                state={state}
                initial={modal === "edit" ? meeting : null}
                project={project === "unassigned" ? "" : project}
                submit={async (title, projectId, occurredAt) => {
                  const result = await run(
                    modal === "edit"
                      ? {
                          op: "meeting.update",
                          id: meeting!.id,
                          title,
                          projectId,
                          occurredAt,
                        }
                      : { op: "meeting.create", title, projectId, occurredAt },
                  );
                  openMeeting(result);
                  setModal(null);
                  if (modal === "create" && createIntent === "import")
                    act({ op: "audio.import", id: result.id });
                }}
              />
            )}
            {modal === "project" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = new FormData(e.currentTarget).get(
                    "name",
                  ) as string;
                  void run({ op: "project.create", name })
                    .then((p) => {
                      setProject(p.id);
                      navigate("library");
                      setModal(null);
                    })
                    .catch(() => {});
                }}
              >
                <h2>{t("新建项目")}</h2>
                <p className="muted">
                  {t("将相关会议归在一起，追踪决策和待办。")}
                </p>
                <label>
                  {t("项目名称")}
                  <input
                    name="name"
                    required
                    maxLength={200}
                    autoFocus
                    placeholder={t("例如：产品研发")}
                  />
                </label>
                <button className="primary">{t("创建项目")}</button>
              </form>
            )}
            {modal === "analyze" && meeting && (
              <>
                <h2>{t("生成分析")}</h2>
                <p className="dialog-description">
                  {t("选择适合本次会议的模板，生成一份新的分析。")}
                </p>
                {meeting.video && (
                  <>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={useVisuals}
                        onChange={(e) => setUseVisuals(e.target.checked)}
                      />
                      {t("结合关键画面生成纪要")}
                    </label>
                    <p className="muted">
                      {useVisuals
                        ? t(
                            "将先完成画面识别，再结合当时发言分析。选中的截图和相关文字会发送到已配置的分析服务。",
                          )
                        : t("本次仅使用转录，画面不会参与分析。")}
                    </p>
                    {useVisuals && !state.settings.visualConsent && (
                      <p className="warning">
                        {t("请先在「服务与备份」确认关键画面的发送范围。")}
                      </p>
                    )}
                  </>
                )}
                <ContextEditor
                  value={meeting.context}
                  templates={state.templates}
                  save={async (context) => {
                    await run({
                      op: "meeting.context",
                      id: meeting.id,
                      context,
                    });
                    await run({
                      op: "job.start",
                      id: meeting.id,
                      kind: "analyze",
                      useVisuals: !!meeting.video && useVisuals,
                    });
                    setModal(null);
                    setTab("analysis");
                  }}
                  submitLabel={t("保存并生成分析")}
                  analysisOnly
                />
              </>
            )}
            {modal === "settings" && (
              <SettingsPanel state={state} run={run} notify={setNotice} />
            )}
            {modal === "templates" && (
              <TemplateManager templates={state.templates} run={run} />
            )}
            {modal === "defaults" && (
              <ProjectDefaults
                state={state}
                run={run}
                initialProject={
                  page === "meeting"
                    ? (meeting?.projectId ?? undefined)
                    : project
                }
              />
            )}
            {modal === "context" && meeting && (
              <>
                <div className="dialog-heading">
                  <span className="eyebrow">MEETING CONTEXT</span>
                  <h2>{t("背景与关键词")}</h2>
                  <p>{t("补充本次会议的上下文，帮助识别术语和理解讨论。")}</p>
                </div>
                <ContextEditor
                  value={meeting.context}
                  templates={state.templates}
                  save={(context) =>
                    run({ op: "meeting.context", id: meeting.id, context })
                  }
                  reload={
                    meeting.projectId
                      ? () =>
                          run({ op: "meeting.reloadDefaults", id: meeting.id })
                      : undefined
                  }
                />
              </>
            )}
            {modal === "record" && meeting && (
              <RecordPanel
                api={api}
                reset={async () => {
                  await recorder.current?.dispose();
                  recorder.current = null;
                  setCaptureName("");
                }}
                onPrepare={async (options) => {
                  await recorder.current?.dispose();
                  const failed = (message: string) => {
                    setError(message);
                    if (recorder.current?.stopping) void stop();
                  };
                  const r = options.screen
                    ? new ScreenRecorder(api, setLevels, failed)
                    : new Recorder(api, setLevels, failed);
                  recorder.current = r;
                  setCaptureName(options.screen ? options.sourceName : "");
                  if (r instanceof ScreenRecorder) {
                    await r.prepare(options);
                    return r.preview;
                  }
                  await r.prepare(options.deviceId, options.system);
                  return undefined;
                }}
                levels={levels}
                start={async () => {
                  setBusy(true);
                  try {
                    await recorder.current!.start(meeting.id);
                    recordingMeeting.current = meeting.id;
                    setElapsed(0);
                    setRecordState("recording");
                    setModal(null);
                    await refresh();
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function MeetingForm({
  state,
  initial,
  project,
  submit,
}: {
  state: State;
  initial: Meeting | null;
  project: string;
  submit: (
    title: string,
    projectId: string | null,
    occurredAt: string,
  ) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const initialDate = new Date(
    initial?.occurredAt ?? initial?.created ?? Date.now(),
  );
  const localDate = new Date(
    initialDate.getTime() - initialDate.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        setPending(true);
        const f = new FormData(e.currentTarget);
        void submit(
          f.get("title") as string,
          (f.get("project") as string) || null,
          new Date(f.get("occurredAt") as string).toISOString(),
        )
          .catch((e) => setError(e.message))
          .finally(() => setPending(false));
      }}
    >
      <h2>{initial ? t("编辑会议信息") : t("创建会议")}</h2>
      <p className="muted">{t("录制新的讨论，或导入已有的会议录音。")}</p>
      <label>
        {t("会议名称")}
        <input
          name="title"
          autoFocus
          required
          maxLength={300}
          defaultValue={initial?.title}
          placeholder={t("例如：产品周会 · 第 36 周")}
        />
      </label>
      <label>
        {t("会议发生时间（本地时区）")}
        <input
          name="occurredAt"
          type="datetime-local"
          required
          defaultValue={localDate}
        />
      </label>
      <label>
        {t("所属项目")}
        <select
          name="project"
          defaultValue={initial ? (initial.projectId ?? "") : project}
        >
          <option value="">{t("未归入项目")}</option>
          {state.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error-text">{localizeMessage(error ?? "")}</p>}
      <button className="primary" disabled={pending}>
        {initial ? t("保存") : t("创建会议")}
      </button>
    </form>
  );
}
function Transcript({
  meeting,
  busy,
  run,
  seek,
  current,
  focus,
  seeking,
}: {
  meeting: Meeting;
  busy: boolean;
  run: (r: Request) => Promise<any>;
  seek: (s: number) => void;
  current: number;
  focus: string;
  seeking: boolean;
}) {
  const [segments, setSegments] = useState(meeting.segments),
    [speakers, setSpeakers] = useState(meeting.speakers),
    [dirty, setDirty] = useState(false),
    [version, setVersion] = useState(meeting.version);
  const [expectedSpeakers, setExpectedSpeakers] = useState("");
  const validSpeakerCount =
    expectedSpeakers === "" ||
    (Number.isInteger(Number(expectedSpeakers)) &&
      Number(expectedSpeakers) >= 1 &&
      Number(expectedSpeakers) <= 50);
  const unresolvedSegments = segments.filter(
    (s) => s.speaker === "unknown" || /^unresolved-\d+$/.test(s.speaker),
  ).length;
  useEffect(() => {
    if (!dirty) {
      setSegments(meeting.segments);
      setSpeakers(meeting.speakers);
      setVersion(meeting.version);
    }
  }, [meeting.version, dirty]);
  const [offset, setOffset] = useState(0);
  const transcriptPanel = useRef<HTMLDivElement>(null);
  const [speakerJump, setSpeakerJump] = useState<{ id: string } | null>(null);
  const jumpToSpeaker = (speaker: string) => {
    const index = segments.reduce(
      (first, s, i) =>
        s.speaker === speaker && (first < 0 || s.start < segments[first].start)
          ? i
          : first,
      -1,
    );
    if (index < 0) return;
    setOffset(Math.floor(index / 60) * 60);
    // A fresh request also scrolls when the same speaker is clicked again.
    setSpeakerJump({ id: segments[index].id });
  };
  useEffect(() => {
    if (!speakerJump) return;
    const frame = requestAnimationFrame(() => {
      const target = transcriptPanel.current?.querySelector<HTMLElement>(
        `[id="${speakerJump.id}"]`,
      );
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ behavior: "instant", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [speakerJump]);
  useEffect(() => {
    setSpeakerJump(null);
    const index = segments.findIndex((s) => s.id === focus);
    if (index >= 0) setOffset(Math.floor(index / 60) * 60);
  }, [focus, seeking]);
  useEffect(() => {
    // Keep a manual speaker lookup in view while the recording continues.
    if (speakerJump) return;
    const index = segments.findIndex(
      (s) => current >= s.start && current < s.end,
    );
    if (index >= 0) setOffset(Math.floor(index / 60) * 60);
  }, [current]);
  useEffect(() => {
    if (offset >= segments.length)
      setOffset(Math.max(0, Math.floor((segments.length - 1) / 60) * 60));
  }, [segments.length, offset]);
  return (
    <div className="panel" ref={transcriptPanel}>
      <div className="panel-heading">
        <h2>
          {t("会议原文")} <span className="pill">v{version}</span>
        </h2>
        <div>
          <button
            disabled={
              busy ||
              dirty ||
              !meeting.audio ||
              segments.length === 0 ||
              !validSpeakerCount
            }
            title={
              dirty
                ? t("请先保存校对")
                : t("根据录音声纹自动统一整场会议的说话人，无需重新转录")
            }
            onClick={() =>
              void run({
                op: "job.start",
                id: meeting.id,
                kind: "speakers",
                expectedSpeakers:
                  expectedSpeakers === ""
                    ? undefined
                    : Number(expectedSpeakers),
              }).catch(() => {})
            }
          >
            {t("自动统一说话人")}
          </button>
          <button
            onClick={() =>
              void run({ op: "transcript.import", id: meeting.id }).catch(
                () => {},
              )
            }
          >
            {t("导入转录 JSON")}
          </button>
          <button
            className="primary"
            disabled={!dirty}
            onClick={() =>
              void run({
                op: "transcript.save",
                id: meeting.id,
                version,
                segments,
                speakers,
              })
                .then((m) => {
                  setVersion(m.version);
                  setDirty(false);
                })
                .catch(() => {})
            }
          >
            {t("保存校对")}
          </button>
        </div>
      </div>
      <div className="speaker-options">
        <label>
          {t("实际发言人数（可选）")}
          <input
            type="number"
            min={1}
            max={50}
            step={1}
            placeholder={t("自动")}
            value={expectedSpeakers}
            disabled={busy}
            onChange={(e) => setExpectedSpeakers(e.target.value)}
          />
        </label>
        <span className="muted">
          {t("留空自动识别；人数仅作参考，声音不清晰的片段仍会标为待确认。")}
        </span>
      </div>
      {unresolvedSegments > 0 && (
        <p className="muted">
          {t(
            "已识别 {p0} 位说话人，另有 {p1} 段发言待确认；待确认标签不代表新增参会者。",
            { p0: speakerCount(segments), p1: unresolvedSegments },
          )}
        </p>
      )}
      {dirty && (
        <p className="warning">
          {t(
            "有未保存的校对。保存后已有分析会标记过期；切换会议或页签会丢弃未保存内容。",
          )}
        </p>
      )}
      {[false, true].map((pending) => {
        const ids = speakerIds(segments).filter(
          (s) => (s === "unknown" || /^unresolved-\d+$/.test(s)) === pending,
        );
        if (!ids.length) return null;
        const fields = (
          <div className="speakers">
            {ids.map((s, i) => (
              <div key={s} className="speaker-editor">
                <button
                  type="button"
                  className="speaker-jump"
                  title={t("定位 {p0} 的第一段发言", {
                    p0: speakers[s] || speakerLabel(s),
                  })}
                  aria-label={t("定位 {p0} 的第一段发言", {
                    p0: speakers[s] || speakerLabel(s),
                  })}
                  onClick={() => jumpToSpeaker(s)}
                >
                  <span className={`avatar color-${i % 4}`}>
                    {pending ? "?" : i + 1}
                  </span>
                  <span>{speakerLabel(s)}</span>
                </button>
                <input
                  aria-label={t("说话人 {p0}", { p0: s })}
                  placeholder={speakerLabel(s)}
                  value={speakers[s] || ""}
                  onChange={(e) => {
                    setSpeakers({ ...speakers, [s]: e.target.value });
                    setDirty(true);
                  }}
                />
                <select
                  aria-label={t("合并说话人 {p0}", { p0: s })}
                  value=""
                  onChange={(e) => {
                    setSegments(
                      segments.map((seg) =>
                        seg.speaker === s
                          ? { ...seg, speaker: e.target.value }
                          : seg,
                      ),
                    );
                    setDirty(true);
                  }}
                >
                  <option value="">{t("合并到…")}</option>
                  {speakerIds(segments)
                    .filter((t) => t !== s)
                    .map((t) => (
                      <option key={t} value={t}>
                        {speakers[t] || speakerLabel(t)}
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>
        );
        return pending ? (
          <details key="pending" className="unresolved-speakers">
            <summary>
              {t("待确认发言（{p0} 段）", { p0: unresolvedSegments })}
            </summary>
            {fields}
          </details>
        ) : (
          <div key="resolved">{fields}</div>
        );
      })}
      {segments.slice(offset, offset + 60).map((s, relativeIndex) => {
        const i = offset + relativeIndex;
        return (
          <article
            id={s.id}
            key={s.id}
            tabIndex={-1}
            className={`segment ${(speakerJump ? speakerJump.id === s.id : focus === s.id || (current >= s.start && current < s.end)) ? "playing" : ""}`}
          >
            <button
              className="timestamp"
              onClick={() => {
                setSpeakerJump(null);
                seek(s.start);
              }}
              aria-label={t("回听 {p0}", { p0: time(s.start) })}
            >
              ▶ {time(s.start)}
            </button>
            <div className="segment-content">
              <div className="speaker-name">
                {speakers[s.speaker] || speakerLabel(s.speaker)}
              </div>
              {s.needsReview && (
                <p className="muted">{t("这段识别结果过短，请回听核对。")}</p>
              )}
              <textarea
                aria-label={t("片段 {p0}", { p0: i + 1 })}
                value={s.text}
                rows={Math.max(2, Math.ceil(s.text.length / 50))}
                onChange={(e) => {
                  setSegments(
                    segments.map((x, j) =>
                      j === i
                        ? { ...x, text: e.target.value, needsReview: false }
                        : x,
                    ),
                  );
                  setDirty(true);
                }}
              />
              <details>
                <summary>{t("时间戳校对")}</summary>
                <div className="time-edit">
                  <label>
                    {t("开始秒")}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={s.start}
                      onChange={(e) => {
                        setSegments(
                          segments.map((x, j) =>
                            j === i
                              ? { ...x, start: Number(e.target.value) }
                              : x,
                          ),
                        );
                        setDirty(true);
                      }}
                    />
                  </label>
                  <label>
                    {t("结束秒")}
                    <input
                      type="number"
                      min={s.start}
                      step="0.01"
                      value={s.end}
                      onChange={(e) => {
                        setSegments(
                          segments.map((x, j) =>
                            j === i ? { ...x, end: Number(e.target.value) } : x,
                          ),
                        );
                        setDirty(true);
                      }}
                    />
                  </label>
                </div>
              </details>
            </div>
          </article>
        );
      })}
      {segments.length > 60 && (
        <div className="pagination" aria-label={t("原文分页")}>
          <button
            disabled={offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 60))}
          >
            {t("上一页原文")}
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 60, segments.length)} /{" "}
            {count("segment", segments.length)}
          </span>
          <button
            disabled={offset + 60 >= segments.length}
            onClick={() => setOffset((n) => n + 60)}
          >
            {t("下一页原文")}
          </button>
        </div>
      )}
      {!segments.length && (
        <div className="empty-panel">
          <span>≋</span>
          <h3>{t("讨论的每个细节，都值得留存")}</h3>
          <p>
            {t("录音或导入音频后，点击「分说话人转录」。")}
            <br />
            {t("也可以导入统一格式的转录 JSON 开始校对。")}
          </p>
        </div>
      )}
    </div>
  );
}
function AnalysisPanel({
  jobs,
  templates,
  meeting,
  refs,
  review,
  clearCitation,
  run,
}: {
  jobs: State["jobs"];
  templates: AnalysisTemplate[];
  meeting: Meeting;
  refs: (e: Evidence[], frames?: VisualFrame[]) => React.ReactNode;
  review: (p: ProposalSelection) => void;
  clearCitation: () => void;
  run: (r: Request) => Promise<any>;
}) {
  const [chosen, setChosen] = useState(""),
    [notes, setNotes] = useState<string | null>(null);
  const [view, setView] = useState<"minutes" | "details">("minutes");
  const a =
    meeting.analyses.find((a) => a.id === chosen) || meeting.analyses.at(-1);
  const previousAnalysis = useRef(a?.id);
  useEffect(() => {
    setNotes(null);
    if (previousAnalysis.current !== a?.id) clearCitation();
    previousAnalysis.current = a?.id;
  }, [a?.id]);
  const renderClaim = (i: number) => {
    const c = a!.claims[i];
    const lines = c.parameterRefs?.length ? c.text.split("\n") : [c.text];
    return (
      <article className="claim" key={i}>
        <div className="claim-label">
          {labelsFor(a!.language)[c.kind]} · {labels[c.change]}
        </div>
        <h3>• {lines[0]}</h3>
        {lines.length > 1 && (
          <p className="claim-parameters">{lines.slice(1).join("\n")}</p>
        )}
        {c.kind === "todo" && (
          <p>
            {t("负责人：")}
            {c.owner || t("未明确")}　{t("截止：")}
            {c.due || t("未明确")}
          </p>
        )}
        {refs(c.evidence, a!.visual?.frames)}
        {["todo", "decision"].includes(c.kind) && (
          <button
            disabled={
              !!meeting.deletedAt ||
              !meeting.projectId ||
              a!.version !== meeting.version ||
              !!(
                a!.visual && a!.visual!.revision !== meeting.video?.revision
              ) ||
              a!.acceptedIndices?.includes(i)
            }
            onClick={() =>
              review({ meetingId: meeting.id, analysisId: a!.id, index: i })
            }
          >
            {a!.acceptedIndices?.includes(i)
              ? t("✓ 已确认")
              : t("确认加入项目记录")}
          </button>
        )}
      </article>
    );
  };
  const renderSection = (
    section: AnalysisSection,
    i: number,
  ): React.ReactNode => (
    <section className="analysis-section" key={i}>
      <h3>{section.title}</h3>
      {section.claimIndices.map(renderClaim)}
      {section.children.map(renderSection)}
    </section>
  );
  if (!a)
    return (
      <div className="empty-panel">
        <span>✧</span>
        <h3>{t("把讨论整理成下一步")}</h3>
        <p>
          {t("完成原文校对后，点击「生成分析」。")}
          <br />
          {t("纪要、决策与待办都会保留原文依据。")}
        </p>
      </div>
    );
  return (
    <div className="panel">
      <div className="panel-heading analysis-heading">
        <div
          className="minutes-tabs"
          role="group"
          aria-label={t("报告阅读方式")}
        >
          <button
            aria-pressed={view === "minutes"}
            onClick={() => setView("minutes")}
          >
            {t("会议纪要")}
          </button>
          <button
            aria-pressed={view === "details"}
            onClick={() => setView("details")}
          >
            {t("详细分析")}
          </button>
        </div>
        {view === "details" && (
          <button
            onClick={() =>
              void run({
                op: "export",
                id: meeting.id,
                analysisId: a.id,
                format: "md",
              }).catch(() => {})
            }
          >
            {t("导出此版本 Markdown")}
          </button>
        )}
        <select
          aria-label={t("分析版本")}
          value={a.id}
          onChange={(e) => {
            setChosen(e.target.value);
            setNotes(null);
          }}
        >
          {meeting.analyses.map((a, i) => (
            <option key={a.id} value={a.id}>
              {t("第")} {i + 1} {t("次 ·")}{" "}
              {a.snapshot ? templateName(a.snapshot.template) : t("旧版分析")}{" "}
              {t("· 转录 v")}
              {a.version}
            </option>
          ))}
        </select>
      </div>
      {view === "details" && (
        <p className="analysis-coverage">
          {a.visual
            ? t("已结合 {p0} 张关键画面{p1}", {
                p0: a.visual.frames.length,
                p1: !meeting.segments.length
                  ? " · 无音轨，仅分析展示内容"
                  : "与转录",
              })
            : t("仅使用转录 · 画面未参与本次分析")}
        </p>
      )}
      {(a.version !== meeting.version ||
        (a.visual && a.visual.revision !== meeting.video?.revision)) && (
        <p className="warning">
          {t("原文或画面选择已修改，此分析已过期。请重新生成后确认项目记录。")}
        </p>
      )}
      {view === "details" &&
        a.snapshot &&
        (JSON.stringify(contextOf(meeting.context)) !==
          JSON.stringify(contextOf(a.snapshot)) ||
          JSON.stringify(
            templates.find((t) => t.id === a.snapshot!.template.id),
          ) !== JSON.stringify(a.snapshot.template)) && (
          <p className="warning">
            {t("此分析使用旧设置，重新生成将保留为新版本。")}
          </p>
        )}
      {view === "details" && a.snapshot && (
        <details>
          <summary>
            {t("本次分析设置 ·")} {templateName(a.snapshot.template)}
          </summary>
          <pre>{JSON.stringify(a.snapshot, null, 2)}</pre>
        </details>
      )}
      {view === "details" && (
        <p className="muted">
          {t("报告语言")}: {languageName(a.language?.locale ?? "zh-CN")}
        </p>
      )}
      {view === "minutes" ? (
        <MinutesPanel
          key={a.id}
          meeting={meeting}
          analysis={a}
          templates={templates}
          jobs={jobs}
          renderClaim={renderClaim}
          run={run}
        />
      ) : (
        <>
          {a.sections
            ? a.sections.map(renderSection)
            : a.claims.map((_, i) => renderClaim(i))}
          <details className="notes">
            <summary>{t("人工修订纪要（单独保存）")}</summary>
            <textarea
              rows={8}
              value={notes ?? a.editedNotes ?? analysisMarkdown(a)}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button
              className="primary"
              onClick={() =>
                void run({
                  op: "analysis.notes",
                  id: meeting.id,
                  analysisId: a.id,
                  notes: notes ?? a.editedNotes ?? analysisMarkdown(a),
                }).catch(() => {})
              }
            >
              {t("保存人工纪要")}
            </button>
          </details>
          <details>
            <summary>{t("原始模型输出")}</summary>
            <pre>{a.raw}</pre>
          </details>
        </>
      )}
    </div>
  );
}
function SettingsPanel({
  state,
  run,
  notify,
  section = "services",
}: {
  section?: string;
  state: State;
  run: (r: Request) => Promise<any>;
  notify: (s: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [asrMode, setAsrMode] = useState(state.settings.asrMode ?? "remote");
  return (
    <>
      {section === "services" && (
        <>
          <h2>{t("服务与权限")}</h2>
          <p className="muted">
            {t("录音、校对记录和分析保存在本机。密钥通过系统凭据加密保存。")}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const settingsForm = e.currentTarget;
              const f = new FormData(settingsForm),
                settings: Settings = {
                  ...state.settings,
                  asrMode,
                  asrUrl: (f.get("asrUrl") as string) || state.settings.asrUrl,
                  baseUrl: f.get("baseUrl") as string,
                  model: f.get("model") as string,
                  contextBudget: Number(f.get("budget")),
                  maxOutputTokens: Number(f.get("maxOutputTokens")),
                  thinkingMode: f.get(
                    "thinkingMode",
                  ) as Settings["thinkingMode"],
                  consent: f.get("consent") === "on",
                  visualConsent: f.get("visualConsent") === "on",
                  visionModel: f.get("visionModel") as string,
                };
              void run({
                op: "settings.save",
                settings,
                ...(f.get("key") ? { key: f.get("key") as string } : {}),
                ...(f.get("asrKey")
                  ? { asrKey: f.get("asrKey") as string }
                  : {}),
              })
                .then(() => {
                  settingsForm
                    .querySelectorAll<HTMLInputElement>(
                      'input[type="password"]',
                    )
                    .forEach((input) => {
                      input.value = "";
                    });
                  setMessage(t("配置已保存"));
                })
                .catch((e) => setMessage(e.message));
            }}
          >
            <section className="settings-section">
              <h3>{t("转录服务")}</h3>
              <p className="muted">
                {t("本地转写无需单独启动服务，录音保留在本机。")}
              </p>
              <label>
                {t("转写方式")}
                <select
                  aria-label={t("转写方式")}
                  value={asrMode}
                  onChange={(e) =>
                    setAsrMode(e.target.value as "local" | "remote")
                  }
                >
                  <option value="local">{t("内置本地转写")}</option>
                  <option value="remote">{t("外部转写服务")}</option>
                </select>
              </label>
              {asrMode === "local" ? (
                <>
                  <p className="muted">
                    {t(
                      "中文使用 Qwen3，英文使用 SenseVoice。请在会议中选择转写语言；纪要和问答仍使用下方分析服务。",
                    )}
                  </p>
                  <p className="muted">
                    {t(
                      "模型按语言下载一次，升级后继续使用。首次转写会自动下载，也可在此提前下载；下载不发送录音，完成后可离线转写。",
                    )}
                  </p>
                  <div className="asr-models">
                    {state.asrModels?.map((model) => {
                      const active = [
                        "queued",
                        "checking",
                        "downloading",
                      ].includes(model.status);
                      const name =
                        model.language === "zh"
                          ? "中文 · Qwen3"
                          : "英文 · SenseVoice";
                      const status = (
                        {
                          missing: "未下载",
                          queued: "等待下载",
                          checking: "检查本地模型",
                          downloading: "正在下载",
                          ready: "已下载",
                          failed: "下载失败",
                          cancelled: "下载已暂停",
                        } as const
                      )[model.status];
                      return (
                        <section
                          className="asr-model"
                          key={model.language}
                          aria-label={t(name)}
                        >
                          <strong>{t(name)}</strong>
                          <span>
                            {t(status)} ·{" "}
                            {Math.round(model.downloadedBytes / 1e6)} /{" "}
                            {Math.round(model.bytes / 1e6)} MB
                          </span>
                          <progress
                            aria-label={t(name)}
                            value={model.downloadedBytes}
                            max={model.bytes}
                          />
                          {model.error && (
                            <small role="status">
                              {localizeMessage(model.error)}
                            </small>
                          )}
                          {model.canCancel ? (
                            <button
                              type="button"
                              onClick={() =>
                                void run({
                                  op: "asr.models.cancel",
                                  language: model.language,
                                }).catch((e) => setMessage(e.message))
                              }
                            >
                              {t("暂停下载")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={active || model.status === "ready"}
                              onClick={() =>
                                void run({
                                  op: "asr.models.download",
                                  language: model.language,
                                }).catch((e) => setMessage(e.message))
                              }
                            >
                              {t(
                                model.status === "ready"
                                  ? "已下载"
                                  : model.status === "missing"
                                    ? "下载模型"
                                    : "继续下载 / 重试",
                              )}
                            </button>
                          )}
                        </section>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="settings-grid">
                  <label>
                    {t("转录服务 URL")}
                    <input
                      name="asrUrl"
                      type="url"
                      required
                      defaultValue={state.settings.asrUrl}
                    />
                    <small>
                      {t(
                        "转录需要单独运行转录服务。本机地址仅在该服务已启动时可用；安装桌面应用不会自动启动服务。",
                      )}
                    </small>
                  </label>
                  <label>
                    {t("转录服务访问令牌")}
                    <input
                      name="asrKey"
                      type="password"
                      placeholder={
                        state.settings.hasAsrKey
                          ? t("已保存（留空保持）")
                          : t("本机服务可留空")
                      }
                    />
                  </label>
                </div>
              )}
            </section>
            <section className="settings-section">
              <h3>{t("分析服务")}</h3>
              <p className="muted">{t("用于会议纪要、项目建议和有据问答。")}</p>
              <div className="settings-grid">
                <label>
                  {t("分析 Base URL")}
                  <input
                    name="baseUrl"
                    type="url"
                    required
                    defaultValue={state.settings.baseUrl}
                  />
                </label>
                <label>
                  {t("分析 API Key")}
                  <input
                    name="key"
                    type="password"
                    placeholder={
                      state.settings.hasKey
                        ? t("已保存（留空保持）")
                        : t("仅在主进程使用")
                    }
                  />
                </label>
                <label>
                  {t("模型名称")}
                  <input
                    name="model"
                    defaultValue={state.settings.model}
                    placeholder={t("服务支持的模型名")}
                  />
                </label>
                <label>
                  {t("上下文预算（tokens）")}
                  <input
                    name="budget"
                    type="number"
                    min={4096}
                    max={200000}
                    defaultValue={state.settings.contextBudget}
                  />
                </label>
                <label>
                  {t("最大输出长度（tokens）")}
                  <input
                    name="maxOutputTokens"
                    aria-label={t("最大输出长度（tokens）")}
                    aria-describedby="max-output-help"
                    type="number"
                    min={1024}
                    max={32768}
                    required
                    defaultValue={state.settings.maxOutputTokens ?? 16384}
                  />
                  <small id="max-output-help">
                    {t(
                      "正文与思考可能共享额度；截断时会在此上限和上下文预算内自动重试一次。",
                    )}
                  </small>
                </label>
                <label>
                  {t("Qwen 思考模式（vLLM）")}
                  <select
                    name="thinkingMode"
                    aria-label={t("Qwen 思考模式（vLLM）")}
                    aria-describedby="thinking-mode-help"
                    defaultValue={state.settings.thinkingMode ?? "default"}
                  >
                    <option value="default">{t("跟随服务设置")}</option>
                    <option value="disabled">{t("关闭思考")}</option>
                    <option value="enabled">{t("开启思考")}</option>
                  </select>
                  <small id="thinking-mode-help">
                    {t(
                      "仅用于支持 Qwen 思考开关的 vLLM 服务。其他服务请选择“跟随服务设置”。",
                    )}
                  </small>
                </label>
                <label>
                  {t("图片模型名称（留空使用分析模型）")}
                  <input
                    name="visionModel"
                    defaultValue={state.settings.visionModel ?? ""}
                    placeholder={t("同一分析服务中支持图片的模型")}
                  />
                  <small>{t("关键画面识别和原图核对使用此模型。")}</small>
                </label>
              </div>
            </section>
            <h3>{t("数据发送范围")}</h3>
            <div className="privacy">
              {asrMode === "remote"
                ? t(
                    "转录会发送所选会议音频、背景和关键词。分析会发送相关转录、背景、关键词、模板要求、校对的姓名映射及项目记录；问答会发送检索到的转录内容。远程服务的数据保留规则由你配置的服务提供方决定。",
                  )
                : t(
                    "本地转写不发送音频。分析与问答会向配置的分析服务发送相关转录、背景、关键词和项目记录。",
                  )}
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                name="consent"
                defaultChecked={state.settings.consent}
              />
              {t("我了解上述发送内容，并允许向配置的服务发送。")}
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                name="visualConsent"
                defaultChecked={state.settings.visualConsent ?? false}
              />
              {t(
                "允许向上述分析服务发送选中的关键画面和画面观察，用于录像分析。",
              )}
            </label>
            <p className="muted">
              {t(
                "录像在本机提取音轨和截图；视频原文件保留在本机。画面识别与核对需要支持图片输入的模型。",
              )}
            </p>
            <button className="primary">{t("保存配置")}</button>{" "}
            <button
              type="button"
              onClick={() =>
                void run({ op: "settings.test" })
                  .then(setMessage)
                  .catch((e) => setMessage(e.message))
              }
            >
              {t("测试已保存的分析连接")}
            </button>{" "}
            <button
              type="button"
              onClick={() =>
                void run({ op: "settings.testVision" })
                  .then(setMessage)
                  .catch((e) => setMessage(e.message))
              }
            >
              {t("测试已保存的图片连接")}
            </button>
            <p role="status">{localizeMessage(message ?? "")}</p>
          </form>
        </>
      )}
      {section === "backup" && (
        <>
          <h2>{t("完整备份与迁移")}</h2>
          <p className="muted">
            {t(
              "包含音视频、关键画面、原始转录、校对历史、分析和引用，不包含服务密钥。恢复会切换会议库，原库保留在本机。",
            )}
          </p>
          <button
            onClick={() =>
              void run({ op: "backup" })
                .then(() => notify(t("备份操作已结束")))
                .catch(() => {})
            }
          >
            {t("导出完整备份")}
          </button>{" "}
          <button
            onClick={() =>
              void run({ op: "restore" })
                .then((p) => {
                  if (p) notify(t("已恢复备份；原库保留在 {p0}", { p0: p }));
                })
                .catch(() => {})
            }
          >
            {t("从备份恢复")}
          </button>
          <p className="muted">
            {t("当前本地会议库：")}
            {state.meetings.length} {t("场会议 ·")}{" "}
            {count("project", state.projects.length)}
          </p>
        </>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
