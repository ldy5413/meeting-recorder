import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../../electron/store";
import type { Analysis } from "../../shared/types";

test("About shows running version; deletion confirms, retains evidence, persists and restores", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meeting-management-"));
  writeFileSync(
    join(directory, "settings.json"),
    JSON.stringify({
      asrUrl: "http://localhost",
      baseUrl: "http://localhost",
      model: "",
      contextBudget: 32768,
      consent: false,
      uiLanguage: "zh-CN",
    }),
  );
  const store = new Store(join(directory, "library", "library.sqlite"));
  const project = store.createProject("删除与恢复验收");
  const created = store.createMeeting("待删除的合成会议", project.id);
  const meeting = store.saveTranscript(
    created.id,
    0,
    [
      {
        id: randomUUID(),
        start: 0,
        end: 2,
        speaker: "speaker-1",
        text: "会议决定采用测试方案。",
      },
    ],
    {},
  );
  const analysis: Analysis = {
    id: randomUUID(),
    created: new Date().toISOString(),
    version: 1,
    raw: "synthetic",
    editedNotes: null,
    claims: [
      {
        kind: "decision",
        text: "采用测试方案",
        owner: null,
        due: null,
        change: "new",
        targetId: null,
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
  store.accept(meeting.id, analysis.id, 0);
  store.createMeeting("保留的会议", null);
  store.close();
  const launch = () =>
    electron.launch({
      args: [".", "--lang=zh-CN"],
      env: { ...process.env, MEETING_DATA_DIR: directory },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.locator(".about-menu summary").click();
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(version);
    await expect(page.locator(".app-version")).toHaveText(`版本 v${version}`);
    expect(
      await page.locator(".app-version").evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }),
    ).toBe(true);
    await page.screenshot({ path: "test-results/about-version.png" });
    await page.locator(".about-menu summary").press("Escape");
    await expect(page.locator(".about-content")).not.toBeVisible();
    await page
      .locator(".meeting-row")
      .filter({ hasText: meeting.title })
      .click();
    await page.getByRole("button", { name: "删除会议", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "删除会议" })).toContainText(
      meeting.title,
    );
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: meeting.title, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "删除会议", exact: true }).click();
    await page.screenshot({ path: "test-results/delete-meeting.png" });
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.locator(".meeting-row")).toHaveCount(1);
    await expect(page.locator(".meeting-row")).toContainText("保留的会议");
    const guard = await page.evaluate(async (id) => {
      try {
        await (window as any).meeting.invoke({
          op: "job.start",
          id,
          kind: "analyze",
        });
        return "allowed";
      } catch (error) {
        return String(error);
      }
    }, meeting.id);
    expect(guard).toContain("会议已删除");
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "项目追踪", exact: true })
      .click();
    await page.getByRole("button", { name: "全部记录", exact: true }).click();
    await expect(page.locator(".tracking-page tbody strong")).toHaveText(
      "采用测试方案",
    );
    await page.locator(".evidence button").first().click();
    await expect(
      page.getByText("此会议已移到最近删除，原文依据仍可查看。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".historical-citation")).toContainText(
      "会议决定采用测试方案。",
    );
    await expect(
      page.getByRole("button", { name: "编辑信息", exact: true }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator(".meeting-row")).toHaveCount(1);
    await page.getByRole("button", { name: "最近删除", exact: true }).click();
    await expect(page.locator(".deleted-meeting")).toContainText(meeting.title);
    await page.screenshot({ path: "test-results/recently-deleted.png" });
    await page.getByRole("button", { name: "恢复会议", exact: true }).click();
    await expect(
      page.getByText("没有已删除的会议", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.locator(".meeting-row")).toHaveCount(2);
    await page.evaluate(async () => {
      const api = (window as any).meeting,
        state = await api.invoke({ op: "state" });
      await api.invoke({
        op: "settings.save",
        settings: { ...state.settings, uiLanguage: "en" },
      });
    });
    await page
      .getByRole("button", { name: "Recently deleted", exact: true })
      .waitFor();
    await page.locator(".about-menu summary").click();
    await expect(page.locator(".app-version")).toHaveText(
      `Version v${version}`,
    );
    await page.setViewportSize({ width: 1100, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/about-version-en.png" });
  } finally {
    await app.close();
  }
});
