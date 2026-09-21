// Opens the real OS capture APIs briefly. No audio is saved or sent to a service.
import { _electron as electron } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    MEETING_DATA_DIR: mkdtempSync(join(tmpdir(), "capture-probe-")),
  },
});
try {
  const page = await app.firstWindow();
  await page
    .getByRole("button", { name: "＋ 新建会议", exact: true })
    .waitFor();
  const result = await page.evaluate(async () => {
    const report = {};
    for (const kind of ["microphone", "system"]) {
      let stream;
      try {
        stream =
          kind === "microphone"
            ? await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false,
              })
            : await navigator.mediaDevices.getDisplayMedia({
                audio: true,
                video: { width: 320, height: 240, frameRate: 1 },
              });
        const audio = stream.getAudioTracks();
        report[kind] = {
          ok: audio.length > 0,
          audioTracks: audio.length,
          tracks: audio.map((t) => ({
            state: t.readyState,
            muted: t.muted,
            sampleRate: t.getSettings().sampleRate,
            channels: t.getSettings().channelCount,
          })),
        };
      } catch (error) {
        report[kind] = { ok: false, error: error.message };
      } finally {
        stream?.getTracks().forEach((t) => t.stop());
      }
    }
    return report;
  });
  const report = {
    date: new Date().toISOString(),
    platform: process.platform,
    ...result,
    scope:
      "Real capture API and live audio track availability only; no audio fidelity or saved recording acceptance.",
  };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
} finally {
  await app.close();
}
