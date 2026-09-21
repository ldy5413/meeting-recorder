import { languageHttpFixture } from "../language-fixture";
import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Store } from "../../electron/store";
import type { Analysis, Meeting, Claim } from "../../shared/types";

function fixture() {
  const data = mkdtempSync(join(tmpdir(), "meeting-redesign-e2e-"));
  const store = new Store(join(data, "library", "library.sqlite"));
  const alpha = store.createProject("项目甲");
  const beta = store.createProject("项目乙");
  const long = store.createMeeting(
    "设计评审 · 长原文",
    alpha.id,
    "2026-09-09T09:00:00-07:00",
  );
  const original = Array.from({ length: 123 }, (_, index) => ({
    id: randomUUID(),
    start: index * 10,
    end: index * 10 + 9,
    speaker: "speaker-1",
    text:
      index === 0
        ? "我们决定采用 SQLite 保存会议。"
        : `第 ${index + 1} 段合成验收原文。保留条件、单位与引用，检查长会议校对。`,
  }));
  const saved = store.saveTranscript(long.id, 0, original, {
    "speaker-1": "张三",
  });
  const old: Analysis = {
    id: randomUUID(),
    version: 1,
    created: new Date().toISOString(),
    raw: "明确标注的合成分析",
    editedNotes: null,
    claims: [
      {
        kind: "decision",
        text: "采用 SQLite",
        owner: null,
        due: null,
        change: "new",
        targetId: null,
        evidence: [{ segmentId: original[0].id, quote: original[0].text }],
      },
    ],
    sections: [{ title: "架构决策", claimIndices: [0], children: [] }],
  };
  saved.analyses = [old];
  store.put("meetings", saved);
  store.saveTranscript(
    long.id,
    1,
    original.map((s, i) =>
      i === 0 ? { ...s, text: "校对后改为本地数据库方案，保留历史原文。" } : s,
    ),
    saved.speakers,
  );
  function actions(title: string, projectId: string, count: number) {
    const m = store.createMeeting(title, projectId);
    const segments = Array.from({ length: count }, (_, i) => ({
      id: randomUUID(),
      start: i * 10,
      end: i * 10 + 9,
      speaker: "speaker-1",
      text: `会议提出完成${title}的第 ${i + 1} 项核对，负责人和日期尚未明确。`,
    }));
    const meeting = store.saveTranscript(m.id, 0, segments, {});
    const claims: Claim[] = segments.map((segment, i) => ({
      kind: "todo",
      text: `${title}第 ${i + 1} 项核对`,
      owner: null,
      due: null,
      change: "new",
      targetId: null,
      evidence: [{ segmentId: segment.id, quote: segment.text }],
    }));
    const analysis: Analysis = {
      id: randomUUID(),
      version: 1,
      created: new Date().toISOString(),
      raw: "合成验收分析",
      editedNotes: null,
      claims,
      sections: [
        {
          title: "未确认人员",
          claimIndices: [],
          children: [
            {
              title: "下周计划",
              claimIndices: claims.map((_, i) => i),
              children: [],
            },
          ],
        },
      ],
    };
    meeting.analyses = [
      {
        ...analysis,
        id: randomUUID(),
        claims: [{ ...claims[0], text: "旧分析，不应重新混入待确认集合" }],
      },
      analysis,
    ];
    store.put("meetings", meeting);
    return meeting;
  }
  const current = actions("项目甲行动", alpha.id, 2);
  const other = actions("项目乙行动", beta.id, 1);
  const unassigned = store.createMeeting("独立会议", null);
  store.close();
  return { data, alpha, beta, long, current, other, unassigned, original, old };
}
const sidebar = (page: Page) => page.locator(".sidebar");
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return (
        document.documentElement.scrollWidth <= window.innerWidth &&
        main.scrollWidth <= main.clientWidth + 1
      );
    }),
  ).toBe(true);
}

test("library filters, historical evidence and long transcript edits remain isolated between meetings", async () => {
  const f = fixture();
  const app = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: f.data },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator(".meeting-row")).toHaveCount(4);
    await page.getByLabel("搜索会议", { exact: true }).fill("不存在");
    await expect(
      page.getByText("没有匹配的会议", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "清除筛选" }).click();
    await sidebar(page)
      .getByRole("button", { name: "未归入项目", exact: true })
      .click();
    await expect(page.locator(".meeting-row")).toHaveCount(1);
    await sidebar(page)
      .getByRole("button", { name: "项目甲", exact: true })
      .click();
    await expect(page.locator(".meeting-row")).toHaveCount(2);
    await page.screenshot({ path: "test-results/redesign-library.png" });
    await page.getByRole("button", { name: "待处理", exact: true }).click();
    await expect(page.locator(".meeting-row")).toHaveCount(0);
    await page.getByRole("button", { name: "全部会议", exact: true }).click();
    await page
      .locator(".meeting-row")
      .filter({ hasText: f.long.title })
      .click();
    await page.getByRole("button", { name: "详细分析", exact: true }).click();
    await page.locator(".claim .evidence button").click();
    await expect(page.locator(".historical-citation")).toContainText("转录 v1");
    await expect(page.locator(".historical-citation")).toContainText(
      f.original[0].text,
    );
    await page.getByRole("button", { name: "转录与回听" }).click();
    await expect(page.getByLabel("片段 1", { exact: true })).toHaveValue(
      "校对后改为本地数据库方案，保留历史原文。",
    );
    await expect(page.locator(".segment")).toHaveCount(60);
    await page.getByRole("button", { name: "下一页原文" }).click();
    await page
      .getByLabel("片段 61", { exact: true })
      .fill("跨页校对仍保留全部原文。");
    await page.getByRole("button", { name: "保存校对", exact: true }).click();
    const updated = await page.evaluate(
      async (id) =>
        (await (window as any).meeting.invoke({ op: "state" })).meetings.find(
          (m: Meeting) => m.id === id,
        ),
      f.long.id,
    );
    expect(updated.segments).toHaveLength(123);
    expect(updated.segments[60].id).toBe(f.original[60].id);
    expect(updated.segments[60].text).toBe("跨页校对仍保留全部原文。");
    expect(updated.segments[122]).toEqual(f.original[122]);
    for (let i = 0; i < 3; i++)
      await page
        .locator(".evidence-panel")
        .getByRole("button", { name: "下一页", exact: true })
        .click();
    await page
      .getByRole("button", { name: "定位 10:00 原文", exact: true })
      .click();
    await expect(
      page.locator(".segment.playing").getByLabel("片段 61", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "会议分析", exact: true }).click();
    await page.getByRole("button", { name: "详细分析", exact: true }).click();
    await page.locator(".claim .evidence button").click();
    await page.screenshot({ path: "test-results/redesign-workspace.png" });
    await page.keyboard.press("Control+k");
    await expect(page.getByLabel("搜索会议", { exact: true })).toBeFocused();
    await page
      .locator(".meeting-row")
      .filter({ hasText: f.current.title })
      .click();
    await page.getByRole("button", { name: "详细分析", exact: true }).click();
    await expect(page.locator(".historical-citation")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "下周计划", exact: true }),
    ).toBeVisible();
    await page.evaluate(async (id) => {
      await (window as any).meeting.invoke({
        op: "meeting.update",
        id,
        title: "项目甲行动",
        projectId: null,
      });
    }, f.current.id);
    await expect(page.locator(".meeting-header .eyebrow")).toContainText(
      "未归入项目",
    );
    await page.getByRole("button", { name: "编辑信息", exact: true }).click();
    await expect(page.getByRole("dialog").getByLabel("所属项目")).toHaveValue(
      "",
    );
    await page.keyboard.press("Shift+Tab");
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "保存", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "编辑信息", exact: true }),
    ).toBeFocused();
    for (const width of [1440, 1050, 800, 640]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
    }
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await sidebar(page)
      .getByRole("button", { name: "会议库", exact: false })
      .click();
    await expect(page.locator(".sidebar")).toBeHidden();
    await noOverflow(page);
    await page.screenshot({ path: "test-results/redesign-compact.png" });
  } finally {
    await app.close();
  }
});

test("project tracking reviews the latest proposals by full identity and retains confirmed history", async () => {
  const f = fixture();
  const app = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: f.data },
  });
  try {
    const page = await app.firstWindow();
    await sidebar(page)
      .getByRole("button", { name: "项目追踪", exact: true })
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await expect(page.getByText("旧分析，不应重新混入待确认集合")).toHaveCount(
      0,
    );
    await page.getByLabel("追踪项目").selectOption(f.alpha.id);
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await page
      .locator("tbody tr")
      .first()
      .getByRole("button", { name: "核对确认" })
      .click();
    await expect(page.getByRole("dialog").getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toContainText("负责人：未明确");
    await page
      .getByRole("button", { name: "确认加入项目", exact: true })
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    const records = await page.evaluate(
      async () =>
        (await (window as any).meeting.invoke({ op: "state" })).records,
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      projectId: f.alpha.id,
      owner: null,
      due: null,
      status: "open",
    });
    await page.getByRole("button", { name: "全部记录", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByText("查看详情 · 变更历史 1", { exact: true }).click();
    await expect(page.locator(".history")).toContainText(
      f.current.analyses[1].claims[0].text,
    );
    await page.screenshot({ path: "test-results/redesign-tracking.png" });
    await page.getByLabel("追踪项目").selectOption(f.beta.id);
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await page.getByRole("button", { name: "待确认", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page
      .locator(".heading-actions")
      .getByRole("button", { name: "项目默认设置" })
      .click();
    await expect(page.getByRole("dialog").getByLabel("选择项目")).toHaveValue(
      f.beta.id,
    );
    await page.keyboard.press("Escape");
    await page.locator("tbody .evidence button").click();
    await expect(
      page.getByRole("heading", { name: f.other.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".historical-citation")).toContainText(
      f.other.segments[0].text,
    );
    await expect(page.getByLabel("分析版本")).toHaveValue(
      f.other.analyses[1].id,
    );
    await page.getByLabel("分析版本").selectOption(f.other.analyses[0].id);
    await expect(page.locator(".historical-citation")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("independent ask uses desktop scope and dates, clears previous answers and resolves evidence", async () => {
  const f = fixture();
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const input = JSON.parse(JSON.parse(body).messages[1].content);
    if (languageHttpFixture(input, res)) return;
    requests.push(input);
    const segment = input.segments[0];
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                text: "合成服务回答：负责人尚未明确。",
                evidence: [{ segmentId: segment.id, quote: segment.text }],
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const app = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: f.data },
  });
  try {
    const page = await app.firstWindow();
    await page.evaluate(
      async (port) => {
        const api = (window as any).meeting;
        const state = await api.invoke({ op: "state" });
        await api.invoke({
          op: "settings.save",
          settings: {
            ...state.settings,
            consent: true,
            model: "explicit-test-fixture",
            baseUrl: `http://127.0.0.1:${port}`,
          },
        });
      },
      (server.address() as any).port,
    );
    await sidebar(page)
      .getByRole("button", { name: "有据问答", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "✧ 查询原文并回答" }),
    ).toBeDisabled();
    await page.getByLabel("会议范围").selectOption(`meeting:${f.current.id}`);
    await page.getByLabel("你的问题").fill("负责人");
    await page.getByRole("button", { name: "✧ 查询原文并回答" }).click();
    await expect(page.locator(".answer")).toContainText(
      "合成服务回答：负责人尚未明确。",
    );
    expect(
      requests
        .flatMap((r) => r.segments)
        .every((s) => f.current.segments.some((own) => own.id === s.id)),
    ).toBe(true);
    await expect(page.locator(".answer small")).toContainText(
      "已核对 2 个候选片段",
    );
    await page.screenshot({ path: "test-results/redesign-ask.png" });
    await page.getByLabel("开始日期").fill("2099-01-01");
    await expect(page.locator(".answer")).toHaveCount(0);
    await page.getByRole("button", { name: "✧ 查询原文并回答" }).click();
    await expect(page.locator(".answer")).toContainText("没有匹配的转录片段");
    expect(requests).toHaveLength(1);
    await page.getByLabel("开始日期").fill("");
    await page.getByLabel("会议范围").selectOption(`project:${f.beta.id}`);
    await expect(page.locator(".answer")).toHaveCount(0);
    await page.getByRole("button", { name: "✧ 查询原文并回答" }).click();
    await expect(page.locator(".answer")).toContainText("已核对 1 个候选片段");
    await page.locator(".answer .evidence button").click();
    await expect(
      page.getByRole("heading", { name: f.other.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".historical-citation")).toContainText(
      f.other.segments[0].text,
    );
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("exports and complete backup restore use the existing desktop files and reset restored navigation", async () => {
  const f = fixture();
  const app = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: f.data },
  });
  const markdown = join(f.data, "review.md"),
    srt = join(f.data, "review.srt"),
    archive = join(f.data, "library.tar.gz");
  const saveTo = (path: string) =>
    app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, path);
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .locator(".meeting-row")
      .filter({ hasText: f.long.title })
      .click();
    await saveTo(markdown);
    await page.getByRole("button", { name: "详细分析", exact: true }).click();
    await page
      .getByRole("button", { name: "导出此版本 Markdown", exact: true })
      .click();
    await expect.poll(() => existsSync(markdown)).toBe(true);
    expect(readFileSync(markdown, "utf8")).toContain("架构决策");
    await saveTo(srt);
    await page.getByRole("button", { name: "SRT", exact: true }).click();
    await expect.poll(() => existsSync(srt)).toBe(true);
    expect(readFileSync(srt, "utf8")).toContain("第 123 段合成验收原文");
    await sidebar(page)
      .getByRole("button", { name: "服务与备份", exact: true })
      .click();
    expect(
      await page.locator("#main-content").evaluate((el) => el.scrollTop),
    ).toBe(0);
    await page.screenshot({ path: "test-results/redesign-settings.png" });
    await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
    await saveTo(archive);
    await page
      .getByRole("button", { name: "导出完整备份", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("备份操作已结束");
    expect([...readFileSync(archive).subarray(0, 2)]).toEqual([31, 139]);
    await page.screenshot({ path: "test-results/redesign-backup.png" });
    await page.evaluate(async () => {
      await (window as any).meeting.invoke({
        op: "meeting.create",
        title: "备份之后的临时会议",
        projectId: null,
      });
    });
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, archive);
    await page.getByRole("button", { name: "从备份恢复", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "已恢复备份；原库保留在",
    );
    await expect(page.locator(".meeting-row")).toHaveCount(4);
    await expect(page.getByText("备份之后的临时会议")).toHaveCount(0);
    await expect(page.locator(".meeting-header")).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    await sidebar(page)
      .getByRole("button", { name: "分析模板", exact: true })
      .click();
    await page.screenshot({ path: "test-results/redesign-templates.png" });
    for (const width of [1050, 800, 640]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "阅读偏好", exact: true }).click();
    await page.getByLabel("纪要正文大小").selectOption("comfortable");
    await page.getByLabel("默认展开原文栏").uncheck();
    await page.reload();
    await page
      .locator(".meeting-row")
      .filter({ hasText: f.current.title })
      .click();
    await expect(page.locator(".app-shell")).toHaveClass(/comfortable/);
    await expect(page.locator(".evidence-panel")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("meeting-recorder:reading-v1")!),
      ),
    ).toEqual({ comfortable: true, defaultEvidence: false });
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([
      "meeting-recorder:reading-v1",
    ]);
  } finally {
    await app.close();
  }
});
