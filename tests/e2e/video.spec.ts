import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mediaCommand } from "../../electron/video";
import { languageHttpFixture } from "../language-fixture";

test("import video, recognize frames, analyze, follow image citation and exclude it", async () => {
  try {
    await mediaCommand("ffmpeg", ["-version"]);
  } catch {
    test.skip(true, "FFmpeg not installed");
    return;
  }
  const data = mkdtempSync(join(tmpdir(), "meeting-video-ui-")),
    source = join(data, "fixture.mp4");
  await mediaCommand("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=2:d=8",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  let observations = 0;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const content = JSON.parse(body).messages[1].content,
      input = JSON.parse(Array.isArray(content) ? content[0].text : content);
    if (languageHttpFixture(input, res)) return;
    const value = input.proposedClaims
      ? {
          reviews: input.proposedClaims.map((_: any, index: number) => ({
            index,
            supported: true,
            novel: true,
            reason: "测试图片",
          })),
        }
      : input.sections
        ? { supported: true }
        : input.claims
          ? {
              sections: [
                { title: "展示内容", claimIndices: [0], children: [] },
              ],
            }
          : input.frameId
            ? {
                title: "蓝色测试画面",
                text: "蓝色背景",
                uncertain: "",
                contentType: "content",
                parameters: [
                  {
                    object: "测试样本",
                    metric: "测试电压",
                    value: String(++observations),
                    unit: "V",
                    conditions: ["25 °C"],
                  },
                ],
              }
            : {
                claims: [
                  {
                    kind: "summary",
                    text: "录像展示蓝色背景",
                    owner: null,
                    due: null,
                    change: "new",
                    targetId: null,
                    evidence: [
                      {
                        frameId: input.frames[0].id,
                        sourceId: input.frames[0].evidenceSources.find(
                          (s: { quote: string }) => s.quote === "蓝色背景",
                        ).id,
                      },
                    ],
                    parameterRefs: [{ frameId: input.frames[0].id, index: 0 }],
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
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, source);
    const page = await app.firstWindow();
    const id = await page.evaluate(
      async (port) => {
        const invoke = (window as any).meeting.invoke;
        const state = await invoke({ op: "state" });
        await invoke({
          op: "settings.save",
          settings: {
            ...state.settings,
            baseUrl: `http://127.0.0.1:${port}`,
            model: "fixture",
            contextBudget: 65536,
            consent: true,
            visualConsent: true,
          },
        });
        return (
          await invoke({
            op: "meeting.create",
            title: "录像功能验收",
            projectId: null,
          })
        ).id;
      },
      (server.address() as any).port,
    );
    await page.getByRole("button", { name: /录像功能验收/ }).click();
    await page.getByRole("button", { name: /导入录音 \/ 录像/ }).click();
    await expect(page.locator("video")).toBeVisible();
    await app.evaluate(({ shell }) => {
      shell.showItemInFolder = (path: string) => {
        (globalThis as any).revealedMediaPath = path;
      };
    });
    await page.getByRole("button", { name: "原始文件", exact: true }).click();
    const savedPath = join(data, "library", "audio", `${id}.mp4`);
    await expect(page.getByLabel("原始录像路径", { exact: true })).toHaveValue(
      savedPath,
    );
    await page
      .getByRole("button", { name: "在文件夹中显示", exact: true })
      .click();
    expect(
      await app.evaluate(() => (globalThis as any).revealedMediaPath),
    ).toBe(savedPath);
    await page.screenshot({ path: "test-results/media-location.png" });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.duration),
      )
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "会议分析", exact: true }).click();
    await expect(page.locator(".player")).toHaveClass(/compact-player/);
    await page.locator("video").evaluate((v: HTMLVideoElement) => {
      v.currentTime = 2;
      (window as any).previewVideoElement = v;
    });
    await page.getByRole("button", { name: "展开录像", exact: true }).click();
    await expect(page.locator(".player")).not.toHaveClass(/compact-player/);
    expect(
      await page
        .locator("video")
        .evaluate(
          (v: HTMLVideoElement) =>
            v === (window as any).previewVideoElement && v.currentTime >= 2,
        ),
    ).toBe(true);
    await page.getByRole("button", { name: "收起录像", exact: true }).click();
    await expect(page.locator(".player")).toHaveClass(/compact-player/);
    await page.getByRole("button", { name: "录像与画面", exact: true }).click();
    await expect(page.locator(".player")).not.toHaveClass(/compact-player/);
    await page
      .getByRole("button", { name: "提取并识别关键画面", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "蓝色测试画面", exact: true }),
    ).toBeVisible();
    await page.locator(".visual-parameters summary").click();
    await expect(
      page.getByRole("cell", { name: "1 V", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "25 °C", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".visual-preview")
          .evaluate((i: HTMLImageElement) => i.naturalWidth),
      )
      .toBe(320);
    await page.getByRole("button", { name: /生成分析/ }).click();
    // A silent video has no audio language to follow.
    await page.getByLabel("报告语言", { exact: true }).selectOption("zh-CN");
    await expect(page.getByLabel("结合关键画面生成纪要")).toBeChecked();
    await page.getByRole("button", { name: "保存并生成分析" }).click();
    await page.getByRole("button", { name: "详细分析", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /录像展示蓝色背景/ }),
    ).toBeVisible();
    await expect(page.locator(".claim-parameters")).toContainText("25 °C");
    await page.getByRole("button", { name: "↗ 画面 1", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "关键画面", exact: true }),
    ).toBeVisible();
    await page.getByTitle("打开原始清晰截图").click();
    await expect(
      page.getByRole("dialog", { name: "原始清晰截图" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭原图" }).click();
    await page
      .getByRole("button", { name: "重新识别此画面", exact: true })
      .click();
    await expect.poll(() => observations).toBe(2);
    await page.locator(".visual-parameters summary").click();
    await expect(
      page.getByRole("cell", { name: "2 V", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "会议分析", exact: true }).click();
    await expect(page.getByText(/原文或画面选择已修改/)).toBeVisible();
    // Even an unchanged title quote must open the analysis snapshot, not new parameters.
    await page.getByRole("button", { name: "详细分析", exact: true }).click();
    await page.getByRole("button", { name: "↗ 画面 1", exact: true }).click();
    await expect(
      page.getByText("正在查看引用时的画面观察。", { exact: false }),
    ).toBeVisible();
    await page.locator(".visual-parameters summary").click();
    await expect(
      page.getByRole("cell", { name: "1 V", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "查看当前观察", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "2 V", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "排除此画面", exact: true }).click();
    await page.getByRole("button", { name: "会议分析", exact: true }).click();
    await expect(page.getByText(/原文或画面选择已修改/)).toBeVisible();
    await page.getByRole("button", { name: "详细分析", exact: true }).click();
    await page.getByRole("button", { name: "↗ 画面 1", exact: true }).click();
    await expect(page.getByText("蓝色背景", { exact: true })).toBeVisible();
    // A mixed reference cannot bypass the IPC schema.
    const result = await page.evaluate(
      async ({ id, random }) => {
        try {
          await (window as any).meeting.invoke({
            op: "evidence.resolve",
            evidence: { segmentId: id, frameId: random, quote: "x" },
          });
          return "accepted";
        } catch {
          return "rejected";
        }
      },
      { id, random: randomUUID() },
    );
    expect(result).toBe("rejected");
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
