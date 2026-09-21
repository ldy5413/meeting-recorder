import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../../electron/store";
import { reportLabels } from "../../shared/language";
import { createServer } from "node:http";

async function saveLanguage(page: Page, language: "en" | "zh-CN") {
  await page.evaluate(async (uiLanguage) => {
    const api = (window as any).meeting;
    const state = await api.invoke({ op: "state" });
    await api.invoke({
      op: "settings.save",
      settings: { ...state.settings, uiLanguage },
    });
  }, language);
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return (
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        main.scrollWidth <= main.clientWidth + 1
      );
    }),
  ).toBe(true);
}

test("changing interface language during analysis keeps the frozen report language", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meeting-language-running-"));
  let release = () => {};
  let requested = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = createServer(async (req, res) => {
    for await (const _part of req) {
      /* drain synthetic model input */
    }
    requested = true;
    await gate;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          { finish_reason: "stop", message: { content: '{"claims":[]}' } },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  writeFileSync(
    join(directory, "settings.json"),
    JSON.stringify({
      asrUrl: "http://127.0.0.1:8765",
      baseUrl: `http://127.0.0.1:${port}`,
      model: "synthetic-fixture",
      contextBudget: 32768,
      consent: true,
      uiLanguage: "en",
      defaultReportLanguage: "en",
    }),
  );
  const store = new Store(join(directory, "library", "library.sqlite"), () => ({
    defaultReportLanguage: "en",
  }));
  const meeting = store.createMeeting("Synthetic running analysis", null);
  store.saveTranscript(
    meeting.id,
    0,
    [
      {
        id: randomUUID(),
        start: 0,
        end: 5,
        speaker: "speaker-1",
        text: "We discussed the project today.",
      },
    ],
    {},
  );
  store.close();
  const app = await electron.launch({
    args: [".", "--lang=en-US"],
    env: { ...process.env, MEETING_DATA_DIR: directory },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const job = await page.evaluate(
      (id) =>
        (window as any).meeting.invoke({
          op: "job.start",
          id,
          kind: "analyze",
        }),
      meeting.id,
    );
    await expect.poll(() => requested).toBe(true);
    await saveLanguage(page, "zh-CN");
    const state = await page.evaluate(() =>
      (window as any).meeting.invoke({ op: "state" }),
    );
    expect(state.jobs.find((j: { id: string }) => j.id === job.id).status).toBe(
      "running",
    );
    release();
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await (window as any).meeting.invoke({ op: "state" })).jobs.find(
              (j: { id: string }) => j.id === id,
            ).status,
          job.id,
        ),
      )
      .toBe("complete");
    const analysis = await page.evaluate(
      async (id) =>
        (await (window as any).meeting.invoke({ op: "state" })).meetings.find(
          (m: { id: string }) => m.id === id,
        ).analyses[0],
      meeting.id,
    );
    expect(analysis.language.locale).toBe("en");
    expect(analysis.language.requested).toBe("en");
  } finally {
    release();
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("English interface, live draft preservation, independent reports and persistent language settings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meeting-language-e2e-"));
  writeFileSync(
    join(directory, "settings.json"),
    JSON.stringify({
      asrUrl: "http://127.0.0.1:8765",
      baseUrl: "https://api.example.com/v1",
      model: "",
      contextBudget: 32768,
      consent: false,
      uiLanguage: "system",
      defaultReportLanguage: "auto",
    }),
  );
  const store = new Store(join(directory, "library", "library.sqlite"));
  const meeting = store.createMeeting("原始中文会议名称", null);
  const source = {
    id: randomUUID(),
    start: 0,
    end: 30,
    speaker: "speaker-1",
    text: "我们决定采用 SQLite 保存会议。",
  };
  const ready = store.saveTranscript(meeting.id, 0, [source], {});
  ready.analyses.push({
    id: randomUUID(),
    version: ready.version,
    created: new Date().toISOString(),
    raw: "Synthetic fixture",
    editedNotes: null,
    language: { requested: "en", locale: "en", labels: reportLabels.en },
    claims: [
      {
        kind: "decision",
        text: "Use SQLite to store meetings.",
        owner: null,
        due: null,
        targetId: null,
        change: "new",
        evidence: [{ segmentId: source.id, quote: source.text }],
      },
    ],
    sections: [{ title: "Decisions", claimIndices: [0], children: [] }],
  });
  store.put("meetings", ready);
  store.saveTemplate("用户自定义模板", "保留用户原始要求");
  store.close();
  const launch = () =>
    electron.launch({
      args: [".", "--lang=en-US"],
      env: { ...process.env, MEETING_DATA_DIR: directory },
    });
  let app = await launch();
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle("Meeting Recorder");
    await expect(
      page.getByRole("heading", { name: "Meeting library", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: "test-results/language-library-en.png" });
    await page.locator(".meeting-row").click();
    await page
      .getByRole("button", { name: "Detailed analysis", exact: true })
      .click();
    await expect(page.locator(".claim")).toContainText(
      "Use SQLite to store meetings.",
    );
    await page
      .getByRole("button", { name: "✧ Generate analysis", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Report language", { exact: true })
      .selectOption("en");
    const requirements = dialog.locator("textarea").last();
    await requirements.fill("Keep this unsaved draft 原始草稿");
    await saveLanguage(page, "zh-CN");
    await expect(requirements).toHaveValue("Keep this unsaved draft 原始草稿");
    await expect(dialog.getByLabel("报告语言", { exact: true })).toHaveValue(
      "en",
    );
    await expect(page.locator(".claim")).toContainText(
      "Use SQLite to store meetings.",
    );
    await saveLanguage(page, "en");
    await expect(requirements).toHaveValue("Keep this unsaved draft 原始草稿");
    await page.screenshot({
      path: "test-results/language-analysis-dialog-en.png",
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator(".claim .evidence button").click();
    await expect(page.locator(".evidence-panel")).toContainText(source.text);
    await noOverflow(page);
    await page.screenshot({ path: "test-results/language-report-en.png" });
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Services and backup", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Analysis templates", exact: true })
      .last()
      .click();
    await expect(
      page.getByText("Project progress", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("用户自定义模板", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page
      .getByLabel("Report language", { exact: true })
      .selectOption("en");
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await (window as any).meeting.invoke({ op: "state" })).settings
              .defaultReportLanguage,
        ),
      )
      .toBe("en");
    await page
      .getByLabel("Interface language", { exact: true })
      .selectOption("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    await expect(reopened.locator("html")).toHaveAttribute("lang", "zh-CN");
    const saved = await reopened.evaluate(
      async () =>
        (await (window as any).meeting.invoke({ op: "state" })).settings,
    );
    expect(saved.uiLanguage).toBe("zh-CN");
    expect(saved.defaultReportLanguage).toBe("en");
    await saveLanguage(reopened, "en");
    await reopened.setViewportSize({ width: 1060, height: 800 });
    await noOverflow(reopened);
  } finally {
    await app.close();
  }
});
