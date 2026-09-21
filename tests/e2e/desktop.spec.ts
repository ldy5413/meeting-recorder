import { languageHttpFixture } from "../language-fixture";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
test("analysis dialog, weekly sections, evidence navigation and version history", async () => {
  const data = mkdtempSync(join(tmpdir(), "meeting-analysis-e2e-"));
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const input = JSON.parse(JSON.parse(body).messages[1].content);
    if (languageHttpFixture(input, res)) return;
    const value = input.sections
      ? { supported: true }
      : input.claims
        ? input.template.id === "weekly"
          ? { assignments: [{ index: 0, person: "张三", column: "plans" }] }
          : {
              sections: [
                { title: "后续待办", claimIndices: [0], children: [] },
              ],
            }
        : input.proposedClaims
          ? { reviews: [{ index: 0, supported: true, reason: "直接证据充分" }] }
          : {
              claims: [
                {
                  kind: "todo",
                  text: "增加测试",
                  owner: "张三",
                  due: null,
                  targetId: null,
                  change: "new",
                  evidence: [
                    {
                      segmentId: input.segments[0].id,
                      quote: input.segments[0].text,
                    },
                  ],
                },
              ],
            };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(value) },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const app = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: data },
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
            model: "fixture",
            baseUrl: `http://127.0.0.1:${port}`,
            contextBudget: 32768,
          },
        });
        const p = await api.invoke({ op: "project.create", name: "分析项目" });
        const m = await api.invoke({
          op: "meeting.create",
          title: "分析交互测试",
          projectId: p.id,
        });
        await api.invoke({
          op: "transcript.save",
          id: m.id,
          version: 0,
          speakers: { s1: "张三" },
          segments: [
            {
              id: crypto.randomUUID(),
              start: 0,
              end: 2,
              speaker: "s1",
              text: "我下周增加测试。",
            },
          ],
        });
      },
      (server.address() as any).port,
    );
    await page.getByRole("button").filter({ hasText: "分析交互测试" }).click();
    await page.getByRole("button", { name: "✧ 生成分析", exact: true }).click();
    await page
      .locator(".modal")
      .getByLabel("分析模板", { exact: true })
      .selectOption("weekly");
    await page.getByRole("button", { name: "保存并生成分析" }).click();
    await page.getByRole("button", { name: "详细分析", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "下周计划", exact: true }),
    ).toBeVisible();
    await page.getByText("人工修订纪要（单独保存）", { exact: true }).click();
    await expect(page.locator(".notes textarea")).toContainText("下周计划");
    await page.getByRole("button", { name: "确认加入项目记录" }).click();
    await page
      .getByRole("button", { name: "确认加入项目", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "✓ 已确认", exact: true }),
    ).toBeDisabled();
    await page.locator(".claim .evidence button").first().click();
    await expect(page.locator(".historical-citation")).toContainText(
      "我下周增加测试。",
    );
    await page.getByRole("button", { name: "✧ 生成分析", exact: true }).click();
    await page
      .locator(".modal")
      .getByLabel("分析模板", { exact: true })
      .selectOption("project-progress");
    await page.getByRole("button", { name: "保存并生成分析" }).click();
    await expect(
      page.getByRole("heading", { name: "后续待办", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".panel-heading select option")).toHaveCount(2);
    await page.locator(".panel-heading select").selectOption({ index: 0 });
    await expect(
      page.getByRole("heading", { name: "下周计划", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "导出此版本 Markdown" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/analysis-sections.png" });
  } finally {
    await app.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("context editor, template management and project defaults persist through desktop bridge", async () => {
  const data = mkdtempSync(join(tmpdir(), "meeting-context-e2e-"));
  const app = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "服务与备份" }).click();
    await expect(page.getByLabel("模板名称", { exact: true })).toHaveCount(0);
    await page
      .getByLabel("最大输出长度（tokens）", { exact: true })
      .fill("8192");
    await page
      .getByLabel("Qwen 思考模式（vLLM）", { exact: true })
      .selectOption("disabled");
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("配置已保存");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "服务与备份" }).click();
    await expect(
      page.getByLabel("最大输出长度（tokens）", { exact: true }),
    ).toHaveValue("8192");
    await expect(
      page.getByLabel("Qwen 思考模式（vLLM）", { exact: true }),
    ).toHaveValue("disabled");
    await page.screenshot({ path: "test-results/services-settings.png" });
    await page.keyboard.press("Escape");
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "分析模板", exact: false })
      .click();
    await expect(page.getByLabel("分析 Base URL")).toHaveCount(0);
    await expect(page.getByLabel("模板名称", { exact: true })).toHaveAttribute(
      "readonly",
      "",
    );
    await page
      .getByRole("button", { name: "＋ 新建模板", exact: true })
      .click();
    await page.getByLabel("模板名称", { exact: true }).fill("研究周会");
    await page
      .getByLabel("自然语言输出要求")
      .fill("按人整理本周进展和下周计划");
    await page.getByRole("button", { name: "创建自定义模板" }).click();
    await expect(page.getByText("研究周会", { exact: true })).toBeVisible();
    const id = await page.evaluate(async () => {
      const api = (window as any).meeting;
      const state = await api.invoke({ op: "state" });
      const p = await api.invoke({ op: "project.create", name: "材料项目" });
      await api.invoke({
        op: "project.context",
        id: p.id,
        context: {
          background: "材料研究",
          keywords: ["XRD"],
          templateId: state.templates.find((t: any) => t.name === "研究周会")
            .id,
          additionalRequirements: "",
        },
      });
      return (
        await api.invoke({
          op: "meeting.create",
          title: "背景测试",
          projectId: p.id,
        })
      ).id;
    });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button").filter({ hasText: "背景测试" }).click();
    await page.locator(".context-summary").click();
    await expect(page.getByLabel("会议背景", { exact: true })).toHaveValue(
      "材料研究",
    );
    await page.getByLabel("会议背景", { exact: true }).fill("单场背景");
    await page
      .getByLabel("关键词（人名、项目名、技术术语，逗号或换行分隔）")
      .fill("XRD，SiC\n张三");
    await page
      .getByRole("button", { name: "保存背景与分析设置", exact: true })
      .click();
    await expect
      .poll(async () =>
        page.evaluate(
          async (id) =>
            (
              await (window as any).meeting.invoke({ op: "state" })
            ).meetings.find((m: any) => m.id === id).context.keywords,
          id,
        ),
      )
      .toEqual(["XRD", "SiC", "张三"]);
    await page.getByRole("button", { name: "重新载入项目默认值" }).click();
    await expect(page.getByLabel("会议背景", { exact: true })).toHaveValue(
      "材料研究",
    );
    await page.screenshot({ path: "test-results/context-editor.png" });
    await page.keyboard.press("Escape");
    await expect(page.locator(".context-summary")).toBeFocused();
    await page
      .getByRole("button", { name: "项目默认设置", exact: false })
      .click();
    await expect(page.getByLabel("会议背景", { exact: true })).toHaveValue(
      "材料研究",
    );
    await expect(page.getByLabel("模板名称", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "分析模板", exact: false })
      .click();
    const manager = page.locator(".template-manager");
    await page.screenshot({ path: "test-results/template-library.png" });
    await page.setViewportSize({ width: 1050, height: 760 });
    await page.screenshot({
      path: "test-results/template-library-compact.png",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await manager
      .getByRole("button", { name: "复制", exact: true })
      .first()
      .click();
    await expect(page.getByLabel("模板名称", { exact: true })).toHaveValue(
      "项目进度会 副本",
    );
    await manager
      .locator(".template-item")
      .filter({ hasText: "研究周会" })
      .click();
    await page.getByLabel("自然语言输出要求").fill("按主题整理");
    await page.getByRole("button", { name: "保存模板修改" }).click();
    await expect(manager.getByLabel("自然语言输出要求")).toHaveValue(
      "按主题整理",
    );
    await manager.getByRole("button", { name: "删除", exact: true }).click();
    await manager
      .getByRole("button", { name: "确认删除", exact: true })
      .click();
    await expect(manager.getByText("研究周会", { exact: true })).toHaveCount(0);
  } finally {
    await app.close();
  }
});
test("desktop onboarding, project and meeting persistence", async () => {
  const data = mkdtempSync(join(tmpdir(), "meeting-e2e-"));
  const launch = () =>
    electron.launch({
      args: [".", "--lang=zh-CN"],
      env: { ...process.env, MEETING_DATA_DIR: data },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.getByText("从一次会议，")).toBeVisible();
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByPlaceholder("例如：产品研发").fill("端到端测试项目");
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page
      .getByRole("button", { name: "＋ 新建会议", exact: true })
      .click();
    await page.getByPlaceholder("例如：产品周会 · 第 36 周").fill("架构评审");
    await page.getByRole("button", { name: "创建会议", exact: true }).click();
    await expect(page.getByRole("heading", { name: "架构评审" })).toBeVisible();
    const id = await page.evaluate(async () => {
      const state = await (window as any).meeting.invoke({ op: "state" });
      const m = state.meetings[0];
      await (window as any).meeting.invoke({
        op: "transcript.save",
        id: m.id,
        version: 0,
        segments: [
          {
            id: crypto.randomUUID(),
            start: 0,
            end: 5,
            speaker: "s1",
            text: "我们决定采用 SQLite。",
          },
        ],
        speakers: { s1: "张三" },
      });
      return m.id;
    });
    await expect(page.getByLabel("片段 1")).toHaveValue(
      "我们决定采用 SQLite。",
    );
    await page.getByLabel("片段 1").fill("我们决定采用 SQLite WAL。");
    await page.getByRole("button", { name: "保存校对" }).click();
    await expect(page.getByText("v2", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/desktop.png" });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button").filter({ hasText: "架构评审" }).click();
    await expect(page.getByLabel("片段 1")).toHaveValue(
      "我们决定采用 SQLite WAL。",
    );
    const m = await page.evaluate(async (id) => {
      return (
        await (window as any).meeting.invoke({ op: "state" })
      ).meetings.find((m: any) => m.id === id);
    }, id);
    expect(m.version).toBe(2);
  } finally {
    await app.close();
  }
});
test("AudioWorklet microphone recording, pause/resume and playable WAV", async () => {
  const data = mkdtempSync(join(tmpdir(), "meeting-record-e2e-"));
  const app = await electron.launch({
    args: [
      ".",
      "--lang=zh-CN",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
    env: { ...process.env, MEETING_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "＋ 新建会议", exact: true })
      .click();
    await page
      .getByPlaceholder("例如：产品周会 · 第 36 周")
      .fill("合成音频测试");
    await page.getByRole("button", { name: "创建会议", exact: true }).click();
    await page
      .getByRole("button", { name: "● 开始录音 / 录屏", exact: true })
      .click();
    await page.getByLabel("同时录制系统声音").uncheck();
    await page.getByRole("button", { name: "检查设备与权限" }).click();
    await expect(
      page.getByRole("button", { name: "● 开始保存录音" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "● 开始保存录音" }).click();
    const m = await page.evaluate(async () => {
      return (await (window as any).meeting.invoke({ op: "state" }))
        .meetings[0];
    });
    const file = join(data, "library", "audio", `${m.id}.wav`);
    await expect.poll(() => statSync(file).size).toBeGreaterThan(96044);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "继续", exact: true }),
    ).toBeVisible();
    const pausedSize = statSync(file).size;
    await page.waitForTimeout(1300);
    expect(statSync(file).size).toBe(pausedSize);
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await expect.poll(() => statSync(file).size).toBeGreaterThan(pausedSize);
    await page.getByRole("button", { name: "■ 结束并保存" }).click();
    await expect(page.locator(".record-banner")).toHaveCount(0);
    await expect
      .poll(async () =>
        page.locator("audio").evaluate((a: HTMLAudioElement) => a.duration),
      )
      .toBeGreaterThan(1);
    const wav = readFileSync(file);
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    expect(
      readFileSync(join(data, "library", "audio", `${m.id}-mic.wav`)).length,
    ).toBe(wav.length);
    expect(
      readFileSync(join(data, "library", "audio", `${m.id}-system.wav`)).length,
    ).toBe(wav.length);
    expect(
      wav
        .subarray(44)
        .equals(
          readFileSync(
            join(data, "library", "audio", `${m.id}-mic.wav`),
          ).subarray(44),
        ),
    ).toBe(true);
    await page.evaluate(async () => {
      const bridge = (window as any).meeting;
      const state = await bridge.invoke({ op: "state" });
      await bridge.invoke({
        op: "settings.save",
        settings: {
          ...state.settings,
          asrUrl: "http://127.0.0.1:1",
          asrMode: "remote",
          consent: true,
        },
      });
    });
    await page.getByRole("button", { name: "分说话人转录" }).click();
    await expect(page.locator(".job.failed")).toContainText("请先启动转录服务");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(
      page.getByText(
        "已重新提交任务；处理状态或失败原因会显示在下方任务卡片中。",
      ),
    ).toBeVisible();
    await expect(page.locator(".job.failed")).toContainText("无法连接转录服务");
    await expect(page.locator(".job")).toHaveCount(1);
  } finally {
    await app.close();
  }
});
