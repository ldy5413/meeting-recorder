import { _electron as electron } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const executablePath = resolve(process.argv[2]);
const app = await electron.launch({
  executablePath,
  env: {
    ...process.env,
    MEETING_DATA_DIR: mkdtempSync(join(tmpdir(), "meeting-packaged-")),
  },
});
try {
  const page = await app.firstWindow();
  await page
    .getByRole("button", { name: "＋ 新建会议", exact: true })
    .waitFor();
  const state = await page.evaluate(() =>
    window.meeting.invoke({ op: "state" }),
  );
  if (state.meetings.length !== 0)
    throw new Error("Smoke test did not open an isolated library");
  console.log(
    JSON.stringify(
      {
        ok: true,
        executablePath,
        title: await page.title(),
        versions: await app.evaluate(() => process.versions),
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
