import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { mediaCommand } from "../../electron/video";

async function startRecoveryFixture(data: string, synchronized = false) {
  const app = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: data },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).meeting);
  await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const target = new BrowserWindow({
      width: 480,
      height: 320,
      show: false,
      webPreferences: { backgroundThrottling: false },
    });
    await target.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          '<title>Recovery fixture</title><body style="background:#164e63;color:white;font:30px sans-serif">RECOVERY TEST<div id="t"></div><script>setInterval(()=>document.getElementById("t").textContent=Date.now(),100)</script>',
        ),
    );
    target.showInactive();
    const original = desktopCapturer.getSources.bind(desktopCapturer);
    desktopCapturer.getSources = async (options) =>
      (await original(options)).filter((s) => s.name === "Recovery fixture");
  });
  const id = await page.evaluate(
    async () =>
      (
        await (window as any).meeting.invoke({
          op: "meeting.create",
          title: "异常恢复验收",
          projectId: null,
        })
      ).id,
  );
  await page.getByRole("button", { name: /异常恢复验收/ }).click();
  await page.getByRole("button", { name: /开始录音/ }).click();
  await page
    .getByRole("combobox", { name: "录制内容", exact: true })
    .selectOption("screen");
  await page.getByRole("button", { name: /窗口 · Recovery fixture/ }).click();
  await page
    .getByRole("checkbox", { name: "录制麦克风", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "同时录制系统声音", exact: true })
    .uncheck();
  if (synchronized) {
    await page
      .getByRole("checkbox", { name: "同时录制系统声音", exact: true })
      .check();
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getDisplayMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getDisplayMedia = async (options) => {
        const native = await original({ ...options, audio: false });
        native.getTracks().forEach((t) => t.stop());
        const clock = new AudioContext();
        const output = clock.createMediaStreamDestination(),
          gain = clock.createGain(),
          oscillator = clock.createOscillator();
        oscillator.frequency.value = 1000;
        gain.gain.value = 0;
        oscillator.connect(gain).connect(output);
        oscillator.start();
        const epoch = clock.currentTime + 0.5;
        for (let i = 0; i < 30; i++) {
          gain.gain.setValueAtTime(0.25, epoch + i * 2);
          gain.gain.setValueAtTime(0, epoch + i * 2 + 0.2);
        }
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext("2d")!;
        const draw = () => {
          const t = clock.currentTime - epoch;
          ctx.fillStyle = t >= 0 && t % 2 < 0.2 ? "white" : "#082f49";
          ctx.fillRect(0, 0, 320, 180);
          requestAnimationFrame(draw);
        };
        draw();
        await clock.resume();
        return new MediaStream([
          ...canvas.captureStream(30).getVideoTracks(),
          ...output.stream.getAudioTracks(),
        ]);
      };
    });
  }
  await page
    .getByRole("button", { name: "检查设备与权限", exact: true })
    .click();
  await page.getByRole("button", { name: /开始保存录像/ }).click();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() =>
            (window as any).meeting.invoke({ op: "state" }),
          )
        ).meetings[0].capture.nextSeq,
    )
    .toBeGreaterThan(2);
  return { app, page, id };
}

test("a shared audio/video clock stays aligned through pause and resume", async () => {
  test.skip(process.platform !== "win32", "Windows capture");
  const data = mkdtempSync(join(tmpdir(), "screen-sync-"));
  const { app, page, id } = await startRecoveryFixture(data, true);
  try {
    await page.waitForTimeout(2200);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await page.waitForTimeout(1100);
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await page.waitForTimeout(4200);
    await page.getByRole("button", { name: /结束并保存/ }).click();
    await expect(page.locator(".record-banner")).toHaveCount(0);
    const path = join(data, "library", "audio", `${id}.webm`);
    const video = await mediaCommand("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-i",
      path,
      "-an",
      "-vf",
      "fps=50,scale=1:1,format=gray",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    const audio = await mediaCommand("ffmpeg", [
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
    ]);
    const flashes: number[] = [],
      beeps: number[] = [];
    for (let i = 1; i < video.length; i++)
      if (video[i] > 240 && video[i - 1] <= 240) flashes.push(i / 50);
    let previous = false;
    for (
      let offset = 0, index = 0;
      offset + 640 <= audio.length;
      offset += 640, index++
    ) {
      let sum = 0;
      for (let i = 0; i < 160; i++)
        sum += audio.readFloatLE(offset + i * 4) ** 2;
      const loud = Math.sqrt(sum / 160) > 0.02;
      if (loud && !previous) beeps.push(index / 50);
      previous = loud;
    }
    expect(flashes.length).toBeGreaterThan(3);
    expect(beeps.length).toBeGreaterThan(3);
    for (const flash of flashes)
      expect(
        Math.min(...beeps.map((beep) => Math.abs(beep - flash))),
      ).toBeLessThanOrEqual(0.25);
  } finally {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.getTitle() === "Recovery fixture")
        .forEach((w) => w.destroy()),
    );
    await app.close();
  }
});

test("closing the selected window saves the final media instead of capturing a different source", async () => {
  test.skip(process.platform !== "win32", "Windows capture");
  const { app, page } = await startRecoveryFixture(
    mkdtempSync(join(tmpdir(), "screen-source-end-")),
  );
  try {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "Recovery fixture")!
        .destroy(),
    );
    await expect(page.locator(".record-banner")).toHaveCount(0, {
      timeout: 15000,
    });
    const meeting = await page.evaluate(
      async () =>
        (await (window as any).meeting.invoke({ op: "state" })).meetings[0],
    );
    expect(meeting.capture.status).toBe("complete");
    expect(meeting.capture.recovered).toBe(true);
    expect(meeting.video.duration).toBeGreaterThan(1);
  } finally {
    await app.close();
  }
});

test("forced process termination recovers a playable recording on restart", async () => {
  test.skip(process.platform !== "win32", "Windows capture");
  const data = mkdtempSync(join(tmpdir(), "screen-process-crash-"));
  const { app, id } = await startRecoveryFixture(data);
  const exited = new Promise<void>((resolve) =>
    app.process().once("exit", () => resolve()),
  );
  // Windows child processes can retain inherited handles after terminating only the parent.
  execFileSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await exited;
  const restored = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: data },
  });
  try {
    const page = await restored.firstWindow();
    await page.waitForFunction(() => !!(window as any).meeting);
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() =>
              (window as any).meeting.invoke({ op: "state" }),
            )
          ).meetings[0].capture.status,
      )
      .toBe("complete");
    const meeting = await page.evaluate(
      async () =>
        (await (window as any).meeting.invoke({ op: "state" })).meetings[0],
    );
    expect(meeting.id).toBe(id);
    expect(meeting.capture.recovered).toBe(true);
    expect(meeting.video.duration).toBeGreaterThan(1);
    await page.getByRole("button", { name: /异常恢复验收/ }).click();
    await expect(page.locator("video")).toBeVisible();
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.duration),
      )
      .toBeGreaterThan(1);
  } finally {
    await restored.close();
  }
});

test("save and exit flushes the encoder before quitting", async () => {
  test.skip(process.platform !== "win32", "Windows capture");
  const data = mkdtempSync(join(tmpdir(), "screen-normal-exit-"));
  const { app } = await startRecoveryFixture(data);
  const exited = new Promise<void>((resolve) =>
    app.process().once("exit", () => resolve()),
  );
  await app.evaluate(({ BrowserWindow, dialog }) => {
    dialog.showMessageBoxSync = () => 1;
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle() !== "Recovery fixture")!
      .close();
  });
  await exited;
  const restored = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: data },
  });
  try {
    const page = await restored.firstWindow();
    await page.waitForFunction(() => !!(window as any).meeting);
    const meeting = await page.evaluate(
      async () =>
        (await (window as any).meeting.invoke({ op: "state" })).meetings[0],
    );
    expect(meeting.capture.status).toBe("complete");
    expect(meeting.capture.recovered).toBeFalsy();
    expect(meeting.video.duration).toBeGreaterThan(1);
  } finally {
    await restored.close();
  }
});

test("capture a selected test window, pause, resume, save and seek the recording", async () => {
  test.skip(
    process.platform !== "win32",
    "Native screen capture currently targets Windows",
  );
  const data = mkdtempSync(join(tmpdir(), "screen-ui-"));
  const app = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as any).meeting);
    await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const target = new BrowserWindow({
        width: 640,
        height: 420,
        show: false,
        title: "Capture fixture",
        webPreferences: { backgroundThrottling: false },
      });
      await target.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            '<title>Capture fixture</title><body style="margin:0;background:#164e63;color:white;font:36px sans-serif"><h1>SCREEN CAPTURE TEST</h1><div id="clock"></div><script>setInterval(()=>document.getElementById("clock").textContent=new Date().toISOString(),100)</script>',
          ),
      );
      target.showInactive();
      const original = desktopCapturer.getSources.bind(desktopCapturer);
      desktopCapturer.getSources = async (options) =>
        (await original(options)).filter((s) => s.name === "Capture fixture");
    });
    await page.evaluate(async () => {
      await (window as any).meeting.invoke({
        op: "meeting.create",
        title: "录屏验收",
        projectId: null,
      });
    });
    await page.getByRole("button", { name: /录屏验收/ }).click();
    await page.getByRole("button", { name: /开始录音/ }).click();
    await page
      .getByRole("combobox", { name: "录制内容", exact: true })
      .selectOption("screen");
    await page.getByRole("button", { name: /窗口 · Capture fixture/ }).click();
    await page
      .getByRole("checkbox", { name: "录制麦克风", exact: true })
      .uncheck();
    await page
      .getByRole("checkbox", { name: "同时录制系统声音", exact: true })
      .uncheck();
    await page
      .getByRole("button", { name: "检查设备与权限", exact: true })
      .click();
    await expect(page.getByLabel("录屏预览", { exact: true })).toBeVisible();
    mkdirSync(".local", { recursive: true });
    await page.screenshot({ path: ".local/screen-ui-preview.png" });
    await page.getByRole("button", { name: /开始保存录像/ }).click();
    await expect(page.locator(".record-banner")).toContainText("正在录屏");
    await page.waitForTimeout(2300);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(page.locator(".record-banner")).toContainText("录制已暂停");
    await page.waitForTimeout(1600);
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await page.waitForTimeout(2300);
    await page.getByRole("button", { name: /结束并保存/ }).click();
    await expect(page.locator(".record-banner")).toHaveCount(0);
    const state = await page.evaluate(() =>
      (window as any).meeting.invoke({ op: "state" }),
    );
    const meeting = state.meetings.find((m: any) => m.title === "录屏验收");
    expect(meeting.capture.status).toBe("complete");
    expect(meeting.video.duration).toBeGreaterThan(3.5);
    expect(meeting.video.duration).toBeLessThan(5.8);
    expect(meeting.video.hasAudio).toBe(false);
    const video = page.locator("video");
    await expect(video).toBeVisible();
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.duration))
      .toBeGreaterThan(0);
    await video.evaluate((v: HTMLVideoElement) => {
      v.currentTime = 2;
    });
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeCloseTo(2, 0);
  } finally {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .slice(1)
        .forEach((w) => w.destroy());
    });
    await app.close();
  }
});
