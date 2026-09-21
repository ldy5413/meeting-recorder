import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Store } from "../../electron/store";
import { reportLabels } from "../../shared/language";
import { minutesFixture } from "../minutes-fixture";
import type { Analysis, Meeting } from "../../shared/types";

test("minutes default view, retry, template regeneration, evidence, history and short export", async () => {
  const directory = mkdtempSync(join(tmpdir(), "minutes-ui-"));
  let failOnce = true;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const data = JSON.parse(JSON.parse(body).messages[1].content);
    if (data.minutesTask === "support" && failOnce) {
      failOnce = false;
      res.writeHead(503).end("synthetic temporary failure");
      return;
    }
    const result = minutesFixture(data)!;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: result.raw } }],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  writeFileSync(
    join(directory, "settings.json"),
    JSON.stringify({
      asrUrl: "http://localhost",
      baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
      model: "synthetic-fixture",
      contextBudget: 32000,
      consent: true,
      uiLanguage: "zh-CN",
    }),
  );
  const store = new Store(join(directory, "library", "library.sqlite"));
  const created = store.createMeeting("全场纪要交互测试", null);
  store.saveTranscript(
    created.id,
    0,
    [
      {
        id: randomUUID(),
        start: 0,
        end: 4,
        speaker: "speaker-1",
        text: "我下周完成接口验证。",
      },
    ],
    { "speaker-1": "张三" },
  );
  const meeting = store.get<Meeting>("meetings", created.id);
  const analysis: Analysis = {
    id: randomUUID(),
    version: meeting.version,
    created: new Date().toISOString(),
    raw: "[]",
    editedNotes: null,
    snapshot: store.snapshot(meeting),
    language: {
      requested: "zh-CN",
      locale: "zh-CN",
      labels: reportLabels["zh-CN"],
    },
    claims: [
      {
        kind: "todo",
        text: "完成接口验证。",
        owner: "张三",
        due: null,
        targetId: null,
        change: "new",
        evidence: [
          {
            segmentId: meeting.segments[0].id,
            quote: meeting.segments[0].text,
          },
        ],
      },
    ],
  };
  meeting.analyses.push(analysis);
  store.put("meetings", meeting);
  store.close();
  const app = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: directory },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".meeting-row").click();
    await expect(
      page.getByRole("button", { name: "会议纪要", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "生成全场纪要", exact: true })
      .click();
    await expect(page.locator(".job.failed")).toContainText("503");
    await page
      .locator(".job.failed")
      .getByRole("button", { name: "重试" })
      .click();
    await expect(page.locator(".minutes-overview")).toContainText(
      "完成接口验证",
    );
    await expect(page.locator(".minutes-evidence").first()).not.toHaveAttribute(
      "open",
      "",
    );
    await page.locator(".minutes-evidence summary").first().click();
    await page
      .locator(".minutes-evidence[open] .evidence button")
      .first()
      .click();
    await expect(page.locator(".historical-citation")).toContainText(
      "我下周完成接口验证。",
    );
    await page.locator(".minutes-evidence summary").first().click();
    await page.locator(".minutes-settings summary").click();
    await page.getByLabel("纪要模板", { exact: true }).selectOption("weekly");
    await page
      .getByRole("button", { name: "重新提炼纪要", exact: true })
      .click();
    await expect(
      page.getByLabel("纪要版本", { exact: true }).locator("option"),
    ).toHaveCount(2);
    await expect(
      page
        .locator(".minutes-panel")
        .getByRole("heading", { name: "张三", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".minutes-panel")
        .getByRole("heading", { name: "下周计划", exact: true }),
    ).toBeVisible();
    const state = await page.evaluate(() =>
      (window as any).meeting.invoke({ op: "state" }),
    );
    const saved = state.meetings.find(
      (m: Meeting) => m.id === meeting.id,
    ).analyses;
    expect(saved).toHaveLength(1);
    expect(saved[0].claims).toEqual(analysis.claims);
    await page
      .getByLabel("纪要版本", { exact: true })
      .selectOption({ index: 0 });
    await expect(
      page
        .locator(".minutes-panel")
        .getByRole("heading", { name: "后续待办", exact: true }),
    ).toBeVisible();
    const destination = join(directory, "minutes.md");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, destination);
    await page
      .getByRole("button", { name: "导出纪要 Markdown", exact: true })
      .click();
    await expect.poll(() => existsSync(destination)).toBe(true);
    expect(readFileSync(destination, "utf8")).toContain("后续待办");
    expect(readFileSync(destination, "utf8")).not.toContain('<a id="s-');
    await page.screenshot({ path: "test-results/minutes-overview.png" });
    await page.evaluate(async () => {
      const api = (window as any).meeting,
        state = await api.invoke({ op: "state" });
      await api.invoke({
        op: "settings.save",
        settings: { ...state.settings, uiLanguage: "en" },
      });
    });
    await expect(
      page.getByRole("button", { name: "Detailed analysis", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 1100, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/minutes-overview-en.png" });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
