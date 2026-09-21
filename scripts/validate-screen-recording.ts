/** Explicit native-window soak test. Captures only its own synthetic window and fake microphone. */
import { _electron as electron } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { wavHeader } from "../electron/audio";
import { mediaCommand } from "../electron/video";
import type { Meeting } from "../shared/types";

if (process.platform !== "win32")
  throw new Error("This validation requires Windows");
const seconds = Number(
  process.argv.find((s) => s.startsWith("--seconds="))?.split("=")[1] || 7200,
);
if (!Number.isFinite(seconds) || seconds < 15 || seconds > 21600)
  throw new Error("Invalid duration");
const root = resolve(
  process.argv.find((s) => s.startsWith("--output="))?.slice(9) ||
    ".local/screen-validation",
);
const executable = process.argv
  .find((s) => s.startsWith("--executable="))
  ?.slice(13);
const width = Number(
  process.argv.find((s) => s.startsWith("--width="))?.slice(8) || 640,
);
const height = Number(
  process.argv.find((s) => s.startsWith("--height="))?.slice(9) || 420,
);
if (
  !Number.isInteger(width) ||
  !Number.isInteger(height) ||
  width < 320 ||
  width > 1920 ||
  height < 180 ||
  height > 1080
)
  throw new Error("Invalid fixture dimensions");
mkdirSync(root, { recursive: true });
async function record() {
  const wav = join(root, "synthetic-microphone.wav");
  const pcm = Buffer.alloc(48000 * 5 * 2);
  for (let i = 0; i < 48000 * 5; i++)
    pcm.writeInt16LE(
      i < 9600
        ? Math.round(6000 * Math.sin((2 * Math.PI * 1000 * i) / 48000))
        : 0,
      i * 2,
    );
  writeFileSync(wav, Buffer.concat([wavHeader(pcm.length, 48000), pcm]));
  const app = await electron.launch({
    ...(executable ? { executablePath: resolve(executable) } : {}),
    args: [
      ...(executable ? [] : ["."]),
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`,
    ],
    env: { ...process.env, MEETING_DATA_DIR: join(root, "app") },
  });
  let meetingId = "";
  const samples: unknown[] = [];
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as any).meeting);
    await app.evaluate(
      async ({ BrowserWindow, desktopCapturer }, size) => {
        const target = new BrowserWindow({
          width: size.width,
          height: size.height,
          frame: false,
          show: false,
          title: "Capture soak fixture",
          webPreferences: { backgroundThrottling: false },
        });
        await target.loadURL(
          "data:text/html;charset=utf-8," +
            encodeURIComponent(
              '<title>Capture soak fixture</title><body style="margin:0;font:24px sans-serif;color:#38bdf8"><h1>CAPTURE TIMING FIXTURE</h1><p>Synthetic content only</p><div id="clock"></div><script>setInterval(()=>{const t=Date.now();document.body.style.background=t%5000<200?"white":"#082f49";document.getElementById("clock").textContent=new Date(t).toISOString()},20)</script>',
            ),
        );
        target.showInactive();
        const original = desktopCapturer.getSources.bind(desktopCapturer);
        desktopCapturer.getSources = async (options) =>
          (await original(options)).filter(
            (s) => s.id === target.getMediaSourceId(),
          );
      },
      { width, height },
    );
    const meetingTitle = `连续录屏验证 ${Date.now()}`;
    meetingId = await page.evaluate(
      async (title) =>
        (
          await (window as any).meeting.invoke({
            op: "meeting.create",
            title,
            projectId: null,
          })
        ).id,
      meetingTitle,
    );
    await page.getByRole("button", { name: new RegExp(meetingTitle) }).click();
    await page.getByRole("button", { name: /开始录音/ }).click();
    await page
      .getByRole("combobox", { name: "录制内容", exact: true })
      .selectOption("screen");
    await page
      .getByRole("button", { name: /窗口 · Capture soak fixture/ })
      .click();
    await page
      .getByRole("checkbox", { name: "同时录制系统声音", exact: true })
      .uncheck();
    await page
      .getByRole("button", { name: "检查设备与权限", exact: true })
      .click();
    await page.getByRole("button", { name: /开始保存录像/ }).click();
    const started = Date.now();
    let last = -1;
    while (Date.now() - started < seconds * 1000) {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      if (Math.floor(elapsed / 30) !== last) {
        last = Math.floor(elapsed / 30);
        const memory = await app.evaluate(({ app }) =>
          app.getAppMetrics().map((m) => ({
            type: m.type,
            workingSetKB: m.memory.workingSetSize,
            peakKB: m.memory.peakWorkingSetSize,
          })),
        );
        const meeting = await page.evaluate(
          async (id) =>
            (
              await (window as any).meeting.invoke({ op: "state" })
            ).meetings.find((m: any) => m.id === id),
          meetingId,
        );
        if (meeting.capture.status !== "recording")
          throw new Error(
            `Capture ended early: ${meeting.capture.error || meeting.capture.status}`,
          );
        samples.push({
          elapsed,
          bytes: meeting.capture.bytes,
          chunks: meeting.capture.nextSeq,
          memory,
        });
        writeFileSync(
          join(root, "progress.json"),
          JSON.stringify(
            {
              status: "recording",
              started: new Date(started).toISOString(),
              targetSeconds: seconds,
              meetingId,
              samples,
            },
            null,
            2,
          ),
        );
        console.log(
          `Recording ${elapsed}/${seconds}s, ${Math.round(meeting.capture.bytes / 1024 / 1024)} MB`,
        );
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    await page.getByRole("button", { name: /结束并保存/ }).click();
    await page.waitForFunction(
      () => !document.querySelector(".record-banner"),
      undefined,
      {
        timeout: 600000,
      },
    );
    const meeting = await page.evaluate(
      async (id) =>
        (await (window as any).meeting.invoke({ op: "state" })).meetings.find(
          (m: any) => m.id === id,
        ),
      meetingId,
    );
    if (meeting.capture.status !== "complete")
      throw new Error(meeting.capture.error || "Capture did not finalize");
    if (
      Math.abs(meeting.video.duration - seconds) > 3 ||
      !meeting.video.hasAudio
    )
      throw new Error("Recorded duration/audio mismatch");
    writeFileSync(
      join(root, "recording.json"),
      JSON.stringify({ meeting, samples }, null, 2),
    );
    return { meeting, samples };
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .filter((w) => w.getTitle() === "Capture soak fixture")
          .forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app.close();
  }
}

const { meeting, samples }: { meeting: Meeting; samples: unknown[] } =
  process.argv.includes("--verify-only")
    ? JSON.parse(readFileSync(join(root, "recording.json"), "utf8"))
    : await record();
if (
  !meeting.audio ||
  !meeting.video?.hasAudio ||
  meeting.capture?.status !== "complete" ||
  Math.abs(meeting.video.duration - seconds) > 3
)
  throw new Error("Recorded duration/audio/finalization mismatch");
const path = join(root, "app", "library", "audio", meeting.audio);
console.log("Checking visual and audio pulse timing");
const pixels = await mediaCommand("ffmpeg", [
  "-nostdin",
  "-v",
  "error",
  "-i",
  path,
  "-an",
  "-vf",
  "fps=20,scale=1:1,format=gray",
  "-f",
  "rawvideo",
  "pipe:1",
]);
const videoPulses: number[] = [];
for (let i = 1; i < pixels.length; i++)
  if (
    pixels[i] > 195 &&
    pixels[i - 1] <= 195 &&
    i / 20 - (videoPulses.at(-1) ?? -10) > 1
  )
    videoPulses.push(i / 20);
let pending = Buffer.alloc(0),
  count = 0,
  previousLoud = false;
const audioPulses: number[] = [];
await mediaCommand(
  "ffmpeg",
  [
    "-nostdin",
    "-v",
    "error",
    "-i",
    path,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "8000",
    "-f",
    "f32le",
    "pipe:1",
  ],
  undefined,
  (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 1600) {
      let square = 0;
      for (let i = 0; i < 400; i++) square += pending.readFloatLE(i * 4) ** 2;
      const loud = Math.sqrt(square / 400) > 0.025;
      if (loud && !previousLoud && count / 20 - (audioPulses.at(-1) ?? -10) > 1)
        audioPulses.push(count / 20);
      previousLoud = loud;
      count++;
      pending = pending.subarray(1600);
    }
  },
);
if (videoPulses.length < seconds / 6 || audioPulses.length < seconds / 6)
  throw new Error(
    `Missing timing markers: video=${videoPulses.length}, audio=${audioPulses.length}`,
  );
const offsets = videoPulses.map(
  (v) =>
    audioPulses.reduce(
      (best, a) => (Math.abs(a - v) < Math.abs(best - v) ? a : best),
      audioPulses[0],
    ) - v,
);
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const startOffset = median(offsets.slice(0, 20)),
  endOffset = median(offsets.slice(-20));
// Both detectors use 20 Hz bins. Compare integer ticks to avoid floating-point
// error at the inclusive five-tick (250 ms) boundary.
const startTicks = Math.round(startOffset * 20),
  endTicks = Math.round(endOffset * 20),
  rawTicks = endTicks - startTicks,
  driftTicks = rawTicks - Math.round(rawTicks / 100) * 100,
  drift = driftTicks / 20;
const result = {
  status: Math.abs(driftTicks) <= 5 ? "complete" : "failed",
  duration: meeting.video.duration,
  width: meeting.video.width,
  height: meeting.video.height,
  meetingId: meeting.id,
  videoPulses: videoPulses.length,
  audioPulses: audioPulses.length,
  startOffset: startTicks / 20,
  endOffset: endTicks / 20,
  measurementResolutionSeconds: 0.05,
  drift,
  toleranceSeconds: 0.25,
  samples,
};
writeFileSync(join(root, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, samples: samples.length }));
if (result.status !== "complete")
  throw new Error("Audio/video timing drift exceeded tolerance");
