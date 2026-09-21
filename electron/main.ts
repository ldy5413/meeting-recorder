import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  desktopCapturer,
  protocol,
  safeStorage,
  powerMonitor,
  powerSaveBlocker,
  shell,
  net,
} from "electron";
import { join, extname, basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  createReadStream,
  copyFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { Readable } from "node:stream";
import { z } from "zod";
import { describeMessage, translateMessage } from "../shared/messages";
import { resolveUiLocale } from "../shared/language";
import {
  RequestSchema,
  SettingsSchema,
  SegmentSchema,
  type Meeting,
  type Settings,
  type Job,
  type Project,
} from "../shared/types";
import { Store } from "./store";
import { mediaLocation } from "./media-location";
import { Recording, recoverRecording } from "./audio";
import { Services, endpoint } from "./services";
import { LocalAsr } from "./local-asr";
import { AsrModels } from "./asr-models";
import asrCatalog from "../shared/asr-models.json";
import { subtitle, markdown } from "./export";
import { backup, stageRestore, activateRestore } from "./backup";
import { startDevBridge } from "./dev-bridge";
import {
  importMedia,
  frameDirectory,
  captureFrame,
  mediaCommand,
} from "./video";
import {
  ScreenRecording,
  capturePath,
  finalizeScreenRecording,
} from "./screen-recording";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "meeting",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);
if (process.env.MEETING_DATA_DIR)
  app.setPath("userData", process.env.MEETING_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
let win: BrowserWindow,
  store: Store,
  services: Services,
  asrModels: AsrModels,
  recording: { id: string; writer: Recording } | null = null,
  maintenance = false,
  activeRequests = 0;
const mediaOperations = new Set<string>();
let screenRecording: {
  id: string;
  writer: ScreenRecording;
  blocker: number;
} | null = null;
let screenSelection: {
  id: string;
  name: string;
  system: boolean;
  expires: number;
} | null = null;
let screenGrant: { name: string } | null = null;
let quitAfterCapture = false;
const finalizingScreens = new Map<string, Promise<void>>();
const library = () => join(app.getPath("userData"), "library");
const audioDir = () => join(library(), "audio");
const settingsPath = () => join(app.getPath("userData"), "settings.json");
const defaults: Settings = {
  asrMode: process.platform === "win32" ? "local" : "remote",
  asrUrl: "http://127.0.0.1:8765",
  baseUrl: "https://api.example.com/v1",
  model: "",
  contextBudget: 32768,
  consent: false,
};
function settings(): Settings {
  return existsSync(settingsPath())
    ? SettingsSchema.parse({
        ...defaults,
        ...JSON.parse(readFileSync(settingsPath(), "utf8")),
      })
    : defaults;
}
const uiText = (text: string) =>
  translateMessage(
    resolveUiLocale(settings().uiLanguage, app.getLocale()),
    text,
  );
function secret(kind: "key" | "asrKey") {
  const path = join(app.getPath("userData"), `${kind}.encrypted`);
  return existsSync(path) ? safeStorage.decryptString(readFileSync(path)) : "";
}
function openStore() {
  asrModels ??= new AsrModels(
    join(app.getPath("userData"), "models", asrCatalog.version),
    asrCatalog,
    (input, init) => net.fetch(String(input), init),
  );
  const resources = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), ".local", "bundled");
  for (const tool of ["ffmpeg", "ffprobe"] as const) {
    const binary = join(
      resources,
      "media",
      process.platform === "win32" ? `${tool}.exe` : tool,
    );
    if (existsSync(binary)) process.env[tool.toUpperCase()] = binary;
  }
  mkdirSync(audioDir(), { recursive: true });
  store = new Store(join(library(), "library.sqlite"), settings);
  store.recover();
  for (const m of store.all<Meeting>("meetings"))
    if (m.deletedAt) continue;
    else if (m.capture && m.capture.status !== "complete") {
      void finishScreenCapture(m.id, true);
    } else if (
      m.status === "interrupted" &&
      m.audio?.endsWith(".wav") &&
      m.mediaType !== "video"
    ) {
      recoverRecording(
        join(audioDir(), `${m.id}-mic.wav`),
        join(audioDir(), `${m.id}-system.wav`),
        join(audioDir(), m.audio),
        m.sampleRate,
      );
    }
  services = new Services(
    store,
    audioDir(),
    settings,
    secret,
    new LocalAsr(
      join(resources, "local-asr"),
      join(library(), "work"),
      asrModels,
    ),
  );
}
function idle() {
  if (
    recording ||
    screenRecording ||
    mediaOperations.size ||
    activeRequests > 1 ||
    services.controllers.size
  )
    throw new Error("请先结束录音，并等待后台任务和文件操作结束");
}
function noActiveMeetingJob(id: string) {
  store.activeMeeting(id);
  if (mediaOperations.has(id))
    throw new Error("正在导入或提取此会议的媒体，请稍后重试");
  if (
    store
      .all<Job>("jobs")
      .some(
        (j) => j.meetingId === id && ["queued", "running"].includes(j.status),
      )
  )
    throw new Error("请先结束此会议的后台任务");
}
function mediaFile(host: string, name: string) {
  if (
    host === "audio" &&
    /^[a-f0-9-]{36}\.(wav|mp3|m4a|mp4|ogg|webm|flac)$/i.test(name) &&
    store.all<Meeting>("meetings").some((m) => m.audio === name)
  )
    return join(audioDir(), name);
  if (
    host === "frames" &&
    /^[a-f0-9-]{36}\.jpg$/i.test(name) &&
    store
      .all<Meeting>("meetings")
      .some((m) =>
        [
          ...(m.video?.frames ?? []),
          ...m.analyses.flatMap((a) => a.visual?.frames ?? []),
        ].some((f) => f.file === name),
      )
  )
    return join(frameDirectory(audioDir()), name);
  return undefined;
}
function finishRecording() {
  if (!recording) return;
  const id = recording.id;
  recording.writer.close();
  recording = null;
  const m = store.get<Meeting>("meetings", id);
  m.status = "ready";
  store.put("meetings", m);
}
function finishScreenCapture(id: string, interrupted = false): Promise<void> {
  const existing = finalizingScreens.get(id);
  if (existing) return existing;
  const work = (async () => {
    if (screenRecording?.id === id) {
      screenRecording.writer.close();
      powerSaveBlocker.stop(screenRecording.blocker);
      screenRecording = null;
    }
    screenGrant = null;
    const m = store.get<Meeting>("meetings", id);
    if (!m.capture || m.capture.status === "complete") return;
    mediaOperations.add(id);
    m.capture.status = "finalizing";
    m.capture.recovered ||= interrupted;
    m.status = "interrupted";
    store.put("meetings", m);
    try {
      const result = await finalizeScreenRecording(
        audioDir(),
        id,
        m.capture.bytes,
        AbortSignal.timeout(10 * 60 * 1000),
      );
      const latest = store.get<Meeting>("meetings", id);
      latest.audio = result.file;
      latest.video = result.video;
      latest.mediaType = "video";
      latest.status = "ready";
      latest.capture!.status = "complete";
      delete latest.capture!.error;
      store.put("meetings", latest);
      try {
        unlinkSync(capturePath(audioDir(), id));
      } catch {
        /* Finalized media is already durable. */
      }
    } catch (error) {
      const latest = store.get<Meeting>("meetings", id);
      latest.capture!.status = "failed";
      latest.capture!.error =
        error instanceof Error ? error.message : String(error);
      latest.status = "interrupted";
      store.put("meetings", latest);
    } finally {
      mediaOperations.delete(id);
    }
  })().finally(() => {
    finalizingScreens.delete(id);
    if (quitAfterCapture && !finalizingScreens.size) app.quit();
  });
  finalizingScreens.set(id, work);
  return work;
}
function requestScreenStop(quit = false) {
  quitAfterCapture ||= quit;
  if (screenRecording) {
    const id = screenRecording.id;
    win?.webContents.send("meeting:capture-stop");
    setTimeout(() => {
      if (screenRecording?.id === id) void finishScreenCapture(id, true);
    }, 5000).unref();
  }
}
app.whenReady().then(async () => {
  openStore();
  powerMonitor.on("suspend", () => {
    if (screenRecording) void finishScreenCapture(screenRecording.id, true);
    if (recording) {
      const id = recording.id;
      finishRecording();
      const m = store.get<Meeting>("meetings", id);
      m.status = "interrupted";
      store.put("meetings", m);
    }
  });
  protocol.handle("meeting", async (req) => {
    try {
      const url = new URL(req.url),
        name = url.pathname.slice(1);
      const file = mediaFile(url.host, name);
      if (!file) return new Response(null, { status: 404 });
      const size = statSync(file).size;
      let start = 0,
        end = size - 1;
      const range = req.headers.get("range");
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) return new Response(null, { status: 416 });
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), end) : end;
        if (start > end || start >= size)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
      }
      const types: Record<string, string> = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".mp4": "video/mp4",
        ".ogg": "audio/ogg",
        ".webm": "video/webm",
        ".jpg": "image/jpeg",
        ".flac": "audio/flac",
      };
      return new Response(
        Readable.toWeb(
          createReadStream(file, { start, end }),
        ) as ReadableStream,
        {
          status: range ? 206 : 200,
          headers: {
            "Content-Type": types[extname(name)],
            "Accept-Ranges": "bytes",
            "Content-Length": String(end - start + 1),
            ...(range
              ? { "Content-Range": `bytes ${start}-${end}/${size}` }
              : {}),
          },
        },
      );
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  const page = pathToFileURL(join(__dirname, "../dist/index.html")).href;
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback) =>
      callback(
        contents === win?.webContents &&
          contents.getURL() === page &&
          ["media", "display-capture"].includes(permission),
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission) =>
      contents === win?.webContents &&
      contents.getURL() === page &&
      ["media", "display-capture"].includes(permission),
  );
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        if (request.frame !== win.webContents.mainFrame) return callback({});
        if (screenSelection) {
          const selection = screenSelection;
          screenSelection = null;
          if (selection.expires < Date.now()) return callback({});
          const sources = await desktopCapturer.getSources({
            types: ["screen", "window"],
            thumbnailSize: { width: 0, height: 0 },
          });
          const source = sources.find((s) => s.id === selection.id);
          if (!source) return callback({});
          screenGrant = { name: selection.name };
          return callback({
            video: source,
            ...(selection.system && request.audioRequested
              ? { audio: "loopback" as const }
              : {}),
          });
        }
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        callback(sources[0] ? { video: sources[0], audio: "loopback" } : {});
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );
  const dispatch = async (input: unknown) => {
    try {
      const r = RequestSchema.parse(input);
      if (maintenance) throw new Error("正在备份或恢复，请稍后");
      activeRequests++;
      try {
        let value: unknown;
        if (
          "id" in r &&
          typeof r.id === "string" &&
          [
            "meeting.update",
            "meeting.context",
            "meeting.reloadDefaults",
            "audio.import",
            "record.start",
            "screen.start",
            "screen.recover",
            "transcript.save",
            "transcript.import",
            "analysis.notes",
            "job.start",
            "video.frame.exclude",
            "video.frame.refresh",
            "video.frame.add",
            "proposal.accept",
          ].includes(r.op)
        )
          store.activeMeeting(r.id);
        switch (r.op) {
          case "state":
            value = {
              asrModels:
                process.platform === "win32" ? asrModels.snapshot() : undefined,
              appVersion: app.getVersion(),
              systemLocale: app.getLocale(),
              meetings: store.all("meetings"),
              projects: store.all("projects"),
              records: store.all("records"),
              jobs: store.all("jobs"),
              templates: store.templates(),
              settings: {
                ...settings(),
                hasKey: !!secret("key"),
                hasAsrKey: !!secret("asrKey"),
              },
            };
            break;
          case "asr.models.download":
            if (process.platform !== "win32")
              throw new Error("本地转写目前仅支持 Windows");
            asrModels.start(r.language);
            break;
          case "asr.models.cancel":
            asrModels.cancel(r.language);
            break;
          case "project.create":
            value = store.createProject(r.name);
            break;
          case "meeting.context":
            value = store.configure("meetings", r.id, r.context);
            break;
          case "project.context":
            value = store.configure("projects", r.id, r.context);
            break;
          case "meeting.reloadDefaults":
            value = store.reloadDefaults(r.id);
            break;
          case "template.save":
            value = store.saveTemplate(r.name, r.requirements, r.id);
            break;
          case "template.delete":
            value = store.deleteTemplate(r.id);
            break;
          case "meeting.create":
            value = store.createMeeting(r.title, r.projectId, r.occurredAt);
            break;
          case "meeting.delete":
            noActiveMeetingJob(r.id);
            if (
              store
                .all<Job>("jobs")
                .some(
                  (job) =>
                    job.meetingId === r.id && services.controllers.has(job.id),
                )
            )
              throw new Error("请先结束此会议的录制和后台任务，再删除会议");
            value = store.deleteMeeting(r.id);
            break;
          case "meeting.restore":
            value = store.restoreMeeting(r.id);
            break;
          case "meeting.update": {
            noActiveMeetingJob(r.id);
            const m = store.get<Meeting>("meetings", r.id);
            if (r.projectId) store.get<Project>("projects", r.projectId);
            if (
              m.projectId !== r.projectId &&
              store
                .all<any>("records")
                .some(
                  (x) =>
                    x.meetingId === m.id ||
                    x.history.some((h: any) => h.meetingId === m.id),
                )
            )
              throw new Error("已有正式项目记录，不能迁移会议");
            Object.assign(m, { title: r.title, projectId: r.projectId });
            if (r.occurredAt !== undefined) m.occurredAt = r.occurredAt;
            store.put("meetings", m);
            value = m;
            break;
          }
          case "media.location":
            value = mediaLocation(
              audioDir(),
              store.get<Meeting>("meetings", r.id),
            );
            break;
          case "media.reveal": {
            const file = mediaLocation(
              audioDir(),
              store.get<Meeting>("meetings", r.id),
            ).files.find((f) => f.kind === r.kind);
            if (!file?.exists)
              throw new Error("文件未找到，可能已被移动或删除");
            shell.showItemInFolder(file.path);
            break;
          }
          case "audio.import": {
            noActiveMeetingJob(r.id);
            const m = store.get<Meeting>("meetings", r.id);
            if (m.audio || m.capture || m.segments.length)
              throw new Error("请新建会议导入，以保留现有原始资料");
            const result = await dialog.showOpenDialog(win, {
              properties: ["openFile"],
              filters: [
                {
                  name: uiText("录音"),
                  extensions: [
                    "wav",
                    "mp3",
                    "m4a",
                    "mp4",
                    "ogg",
                    "webm",
                    "flac",
                  ],
                },
              ],
            });
            if (!result.canceled) {
              const latest = store.get<Meeting>("meetings", r.id);
              if (latest.audio || latest.segments.length)
                throw new Error("会议内容已改变，请新建会议导入");
              noActiveMeetingJob(r.id);
              Object.assign(m, latest);
              mediaOperations.add(r.id);
              try {
                value = await importMedia(
                  store,
                  audioDir(),
                  r.id,
                  result.filePaths[0],
                );
              } finally {
                mediaOperations.delete(r.id);
              }
            }
            break;
          }
          case "record.start": {
            noActiveMeetingJob(r.id);
            if (recording || screenRecording || finalizingScreens.size)
              throw new Error("已有录制进行中");
            const m = store.get<Meeting>("meetings", r.id);
            if (m.audio || m.segments.length)
              throw new Error("请新建会议开始录音");
            const writer = new Recording(
              [`${r.id}-mic.wav`, `${r.id}-system.wav`, `${r.id}.wav`].map(
                (n) => join(audioDir(), n),
              ),
              r.sampleRate,
            );
            recording = { id: r.id, writer };
            m.status = "recording";
            m.audio = `${r.id}.wav`;
            m.sampleRate = r.sampleRate;
            store.put("meetings", m);
            break;
          }
          case "record.chunk":
            if (recording?.id !== r.id) throw new Error("录音已停止");
            try {
              recording.writer.append(r.seq, r.mic, r.system);
            } catch (e) {
              finishRecording();
              const m = store.get<Meeting>("meetings", r.id);
              m.status = "interrupted";
              store.put("meetings", m);
              throw e;
            }
            break;
          case "record.stop":
            if (recording?.id === r.id) finishRecording();
            break;
          case "screen.sources": {
            if (process.platform !== "win32")
              throw new Error(
                "应用内录屏当前先支持 Windows；其他系统可导入录像",
              );
            const sources = await desktopCapturer.getSources({
              types: ["screen", "window"],
              thumbnailSize: { width: 320, height: 180 },
            });
            value = sources
              .filter((s) => s.id !== win.getMediaSourceId())
              .map((s) => ({
                id: s.id,
                name: s.name,
                thumbnail: s.thumbnail.toDataURL(),
                kind: s.id.startsWith("screen:") ? "screen" : "window",
              }));
            break;
          }
          case "screen.select": {
            if (process.platform !== "win32")
              throw new Error("应用内录屏当前先支持 Windows");
            if (recording || screenRecording || finalizingScreens.size)
              throw new Error("已有录制进行中");
            await Promise.all([
              mediaCommand("ffmpeg", ["-version"], AbortSignal.timeout(10000)),
              mediaCommand("ffprobe", ["-version"], AbortSignal.timeout(10000)),
            ]);
            const sources = await desktopCapturer.getSources({
              types: ["screen", "window"],
              thumbnailSize: { width: 0, height: 0 },
            });
            const source = sources.find(
              (s) => s.id === r.sourceId && s.id !== win.getMediaSourceId(),
            );
            if (!source)
              throw new Error("所选窗口或显示器已不可用，请重新选择");
            screenSelection = {
              id: source.id,
              name: source.name,
              system: r.system,
              expires: Date.now() + 60000,
            };
            screenGrant = null;
            break;
          }
          case "screen.start": {
            noActiveMeetingJob(r.id);
            if (
              recording ||
              screenRecording ||
              finalizingScreens.size ||
              !screenGrant
            )
              throw new Error("请重新检查录制来源与权限");
            const m = store.get<Meeting>("meetings", r.id);
            if (m.audio || m.capture || m.segments.length)
              throw new Error("请新建会议开始录屏");
            const writer = new ScreenRecording(audioDir(), r.id);
            screenRecording = {
              id: r.id,
              writer,
              blocker: powerSaveBlocker.start("prevent-app-suspension"),
            };
            m.capture = {
              status: "recording",
              sourceName: screenGrant.name,
              bytes: 0,
              nextSeq: 0,
            };
            m.mediaType = "video";
            m.status = "recording";
            store.put("meetings", m);
            break;
          }
          case "screen.chunk": {
            if (screenRecording?.id !== r.id)
              throw new Error("录像已停止，已保存部分将进行恢复");
            try {
              screenRecording.writer.append(r.seq, r.data);
              const m = store.get<Meeting>("meetings", r.id);
              m.capture!.bytes = screenRecording.writer.bytes;
              m.capture!.nextSeq = screenRecording.writer.nextSeq;
              store.put("meetings", m);
            } catch (error) {
              void finishScreenCapture(r.id, true);
              throw error;
            }
            break;
          }
          case "screen.stop":
            await finishScreenCapture(r.id, r.interrupted);
            value = store.get<Meeting>("meetings", r.id);
            break;
          case "screen.recover":
            noActiveMeetingJob(r.id);
            if (screenRecording || recording)
              throw new Error("请先结束当前录制");
            await finishScreenCapture(r.id, true);
            value = store.get<Meeting>("meetings", r.id);
            break;
          case "transcript.save":
            value = store.saveTranscript(
              r.id,
              r.version,
              r.segments,
              r.speakers,
            );
            break;
          case "transcript.import": {
            noActiveMeetingJob(r.id);
            const result = await dialog.showOpenDialog(win, {
              properties: ["openFile"],
              filters: [
                { name: uiText("统一转录 JSON"), extensions: ["json"] },
              ],
            });
            if (!result.canceled) {
              const raw = readFileSync(result.filePaths[0], "utf8"),
                data = JSON.parse(raw),
                m = store.get<Meeting>("meetings", r.id);
              const segments = z
                .array(SegmentSchema)
                .parse(Array.isArray(data) ? data : data.segments);
              value = store.saveTranscript(m.id, m.version, segments, {}, raw);
            }
            break;
          }
          case "analysis.notes": {
            const m = store.get<Meeting>("meetings", r.id),
              a = m.analyses.find((a) => a.id === r.analysisId);
            if (!a) throw new Error("分析不存在");
            a.editedNotes = r.notes;
            store.put("meetings", m);
            break;
          }
          case "job.start":
            noActiveMeetingJob(r.id);
            value = services.start(
              r.id,
              r.kind,
              r.useVisuals,
              r.sourceAnalysisId,
              true,
              undefined,
              r.expectedSpeakers,
            );
            break;
          case "video.frame.exclude": {
            noActiveMeetingJob(r.id);
            const m = store.get<Meeting>("meetings", r.id),
              frame = m.video?.frames.find((f) => f.id === r.frameId);
            if (!frame) throw new Error("画面不存在");
            if (frame.excluded !== r.excluded) {
              frame.excluded = r.excluded;
              if (!r.excluded && !frame.text) {
                // Give an automatically excluded, empty observation another look.
                delete frame.model;
                delete frame.contentType;
              }
              m.video!.revision++;
              store.put("meetings", m);
            }
            break;
          }
          case "video.frame.refresh": {
            noActiveMeetingJob(r.id);
            const m = store.get<Meeting>("meetings", r.id);
            const frame = m.video?.frames.find((f) => f.id === r.frameId);
            if (!frame) throw new Error("画面不存在");
            if (frame.excluded) throw new Error("请先将此画面重新用于分析");
            frame.needsRecognition = true;
            m.video!.revision++;
            store.put("meetings", m);
            value = services.start(r.id, "visuals");
            break;
          }
          case "video.frame.add": {
            noActiveMeetingJob(r.id);
            const m = store.get<Meeting>("meetings", r.id);
            if (!m.video?.extracted || !m.audio)
              throw new Error("请先提取关键画面");
            if (r.time >= m.video.duration || m.video.frames.length >= 1000)
              throw new Error("画面时间或数量超出范围");
            mediaOperations.add(r.id);
            try {
              const frame = await captureFrame(
                join(audioDir(), m.audio),
                frameDirectory(audioDir()),
                r.time,
                m.video.frames.find((f) => f.start > r.time)?.start ??
                  m.video.duration,
                AbortSignal.timeout(60000),
              );
              const latest = store.get<Meeting>("meetings", r.id);
              latest.video!.frames.push(frame);
              latest.video!.frames.sort((a, b) => a.start - b.start);
              latest.video!.revision++;
              store.put("meetings", latest);
              value = frame;
            } finally {
              mediaOperations.delete(r.id);
            }
            break;
          }
          case "job.retry":
            value = services.retry(r.id);
            break;
          case "job.cancel":
            await services.cancel(r.id);
            break;
          case "proposal.accept":
            value = store.accept(r.id, r.analysisId, r.index);
            break;
          case "settings.save": {
            const oldSettings = settings();
            const serviceFields = Object.keys(SettingsSchema.shape).filter(
              (key) => !["uiLanguage", "defaultReportLanguage"].includes(key),
            ) as (keyof Settings)[];
            const serviceChanged =
              serviceFields.some(
                (key) => oldSettings[key] !== r.settings[key],
              ) ||
              r.key !== undefined ||
              r.asrKey !== undefined;
            if (
              serviceChanged &&
              (services.controllers.size || activeRequests > 1)
            )
              throw new Error("请等待后台请求结束后修改服务配置");
            endpoint(r.settings.asrUrl, "health");
            endpoint(r.settings.baseUrl, "chat/completions");
            for (const kind of ["key", "asrKey"] as const)
              if (r[kind] !== undefined) {
                if (!safeStorage.isEncryptionAvailable())
                  throw new Error("系统凭据加密不可用");
                writeFileSync(
                  join(app.getPath("userData"), `${kind}.encrypted`),
                  safeStorage.encryptString(r[kind]!),
                );
              }
            writeFileSync(`${settingsPath()}.tmp`, JSON.stringify(r.settings));
            renameSync(`${settingsPath()}.tmp`, settingsPath());
            break;
          }
          case "settings.test":
            await services.chat('只输出 JSON {"ok":true}。', {
              test: "连接测试，不含会议内容",
            });
            value = "分析接口连接成功";
            break;
          case "settings.testVision": {
            // A public-domain one-pixel PNG tests the image request format without meeting data.
            await services.chat(
              '只输出 JSON {"ok":true}。',
              { test: "图片接口连接测试，不含会议内容" },
              undefined,
              [
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aETsAAAAASUVORK5CYII=",
              ],
            );
            value = "图片接口请求成功；实际小字与图表识别质量需用录像核对";
            break;
          }
          case "evidence.resolve":
            value = store.resolveEvidence(r.evidence);
            break;
          case "ask":
            value = await services.ask(
              r.question,
              r.projectId,
              r.meetingId,
              r.from,
              r.to,
            );
            break;
          case "export": {
            const m = store.get<Meeting>("meetings", r.id),
              out = await dialog.showSaveDialog(win, {
                defaultPath: `${m.title.replace(/[<>:"/\\|?*]/g, "_")}.${r.format}`,
                filters: [{ name: r.format, extensions: [r.format] }],
              });
            if (out.filePath) {
              const assetFolder = `${basename(out.filePath)}.assets`;
              if (r.format === "md" && r.scope !== "minutes") {
                const analysis = r.analysisId
                  ? m.analyses.find((a) => a.id === r.analysisId)
                  : m.analyses.at(-1);
                const frames =
                  analysis?.visual?.frames.filter((f) =>
                    analysis.claims.some((c) =>
                      c.evidence.some((e) => e.frameId === f.id),
                    ),
                  ) ?? [];
                if (frames.length)
                  mkdirSync(join(dirname(out.filePath), assetFolder), {
                    recursive: true,
                  });
                for (const frame of frames)
                  copyFileSync(
                    join(frameDirectory(audioDir()), frame.file),
                    join(dirname(out.filePath), assetFolder, frame.file),
                  );
              }
              writeFileSync(
                out.filePath,
                r.format === "md"
                  ? markdown(m, r.analysisId, assetFolder, {
                      minutesId: r.minutesId,
                      scope: r.scope,
                    })
                  : subtitle(m),
              );
            }
            break;
          }
          case "backup": {
            idle();
            maintenance = true;
            try {
              const out = await dialog.showSaveDialog(win, {
                defaultPath: `meeting-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`,
              });
              if (out.filePath) {
                const preferences = settings();
                store.db
                  .prepare("INSERT OR REPLACE INTO meta VALUES (?,?)")
                  .run(
                    "languagePreferences",
                    JSON.stringify({
                      uiLanguage: preferences.uiLanguage ?? "system",
                      defaultReportLanguage:
                        preferences.defaultReportLanguage ?? "auto",
                    }),
                  );
                await backup(store, library(), out.filePath);
              }
            } finally {
              maintenance = false;
            }
            break;
          }
          case "restore": {
            idle();
            maintenance = true;
            try {
              const input = await dialog.showOpenDialog(win, {
                properties: ["openFile"],
                filters: [{ name: uiText("会议备份"), extensions: ["gz"] }],
              });
              if (!input.canceled) {
                const staging = await stageRestore(
                  input.filePaths[0],
                  library(),
                );
                store.close();
                try {
                  value = activateRestore(staging, library());
                } finally {
                  openStore();
                }
                const preferences = store.db
                  .prepare(
                    "SELECT value FROM meta WHERE key='languagePreferences'",
                  )
                  .get();
                if (preferences) {
                  const restored = SettingsSchema.pick({
                    uiLanguage: true,
                    defaultReportLanguage: true,
                  }).parse(JSON.parse(preferences.value as string));
                  writeFileSync(
                    `${settingsPath()}.tmp`,
                    JSON.stringify({ ...settings(), ...restored }),
                  );
                  renameSync(`${settingsPath()}.tmp`, settingsPath());
                }
              }
            } finally {
              maintenance = false;
            }
            break;
          }
        }
        return { ok: true, value };
      } finally {
        activeRequests--;
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { ok: false, error, errorMessage: describeMessage(error) };
    }
  };
  ipcMain.handle("meeting:request", async (event, input) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      event.senderFrame.url !== page
    )
      return { ok: false, error: "未授权的界面" };
    return dispatch(input);
  });
  if (!app.isPackaged && process.env.MEETING_DEV_BROWSER === "1") {
    const fixtureFiles: Record<string, string | undefined> = {
      july: process.env.MEETING_DEV_FIXTURE_JULY,
      august: process.env.MEETING_DEV_FIXTURE_AUGUST,
    };
    const bridge = await startDevBridge({
      dist: join(__dirname, "../dist"),
      userData: app.getPath("userData"),
      dispatch: async (input) => {
        if ((input as { op?: string })?.op?.startsWith("screen."))
          return { ok: false, error: "请在桌面应用中录屏" };
        if ((input as { op?: string })?.op !== "dev.audio.import")
          return dispatch(input);
        try {
          const r = z
            .object({
              op: z.literal("dev.audio.import"),
              fixture: z.enum(["july", "august"]),
              id: z.string().uuid(),
            })
            .strict()
            .parse(input);
          if (maintenance) throw new Error("正在备份或恢复");
          noActiveMeetingJob(r.id);
          const file = fixtureFiles[r.fixture];
          if (!file || extname(file).toLowerCase() !== ".mp4")
            throw new Error("此开发音频未在启动环境中授权");
          const m = store.get<Meeting>("meetings", r.id);
          if (m.audio || m.segments.length || recording?.id === r.id)
            throw new Error("请新建会议导入");
          activeRequests++;
          mediaOperations.add(r.id);
          try {
            return {
              ok: true,
              value: await importMedia(store, audioDir(), r.id, file),
            };
          } finally {
            activeRequests--;
            mediaOperations.delete(r.id);
          }
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      audio: (name) => mediaFile("audio", name),
      frame: (name) => mediaFile("frames", name),
    });
    app.once("before-quit", () => bridge.close());
  }
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1060,
    minHeight: 720,
    backgroundColor: "#f6f7fb",
    title: uiText("会议手记"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("close", (e) => {
    if (screenRecording || finalizingScreens.size) {
      e.preventDefault();
      if (quitAfterCapture) return;
      const answer = dialog.showMessageBoxSync(win, {
        type: "question",
        buttons: [uiText("继续录制"), uiText("保存并退出")],
        defaultId: 0,
        cancelId: 0,
        message: uiText("录像仍在录制或整理，是否保存并退出？"),
      });
      if (answer === 1) requestScreenStop(true);
      return;
    }
    if (recording) {
      const answer = dialog.showMessageBoxSync(win, {
        type: "question",
        buttons: [uiText("继续录音"), uiText("保存并退出")],
        defaultId: 0,
        cancelId: 0,
        message: uiText("会议仍在录音，是否保存并退出？"),
      });
      if (answer === 0) e.preventDefault();
      else finishRecording();
    }
  });
  await win.loadFile(join(__dirname, "../dist/index.html"));
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (e) => {
  if (screenRecording || finalizingScreens.size) {
    e.preventDefault();
    requestScreenStop(true);
    return;
  }
  if (recording) finishRecording();
  services?.controllers.forEach((controller) => controller.abort());
  asrModels?.close();
});
