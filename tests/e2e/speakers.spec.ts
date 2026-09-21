import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

test("repair button saves a new version, hides silence from people and preserves the name", async () => {
  const data = mkdtempSync(join(tmpdir(), "meeting-speakers-e2e-"));
  const segments = [
    {
      id: randomUUID(),
      start: 0,
      end: 1,
      speaker: "chunk-1:speaker-0",
      text: "原文第一句",
    },
    {
      id: randomUUID(),
      start: 1,
      end: 2,
      speaker: "chunk-2:speaker-1",
      text: "原文第二句",
    },
    {
      id: randomUUID(),
      start: 2,
      end: 3,
      speaker: "chunk-2:speaker-unknown",
      text: "[Silence]",
    },
  ];
  const remoteId = randomUUID();
  let uploaded = "";
  const server = createServer(async (req, res) => {
    for await (const chunk of req) {
      uploaded += chunk;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/health"
          ? { speaker_resolution_version: 1, speaker_count_hint: true }
          : req.method === "POST"
            ? { id: remoteId }
            : {
                status: "complete",
                segments: segments.map((s, i) => ({
                  ...s,
                  speaker: i === 2 ? "non-speech" : "speaker-1",
                })),
              },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const app = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.evaluate(
      async ({ segments, port }) => {
        const invoke = (window as any).meeting.invoke;
        const state = await invoke({ op: "state" });
        await invoke({
          op: "settings.save",
          settings: {
            ...state.settings,
            consent: true,
            asrUrl: `http://127.0.0.1:${port}`,
            asrMode: "remote",
          },
        });
        const m = await invoke({
          op: "meeting.create",
          title: "说话人修复验收",
          projectId: null,
        });
        await invoke({ op: "record.start", id: m.id, sampleRate: 16000 });
        for (let seq = 0; seq < 3; seq++) {
          await invoke({
            op: "record.chunk",
            id: m.id,
            seq,
            mic: new Uint8Array(32000),
            system: new Uint8Array(32000),
          });
        }
        await invoke({ op: "record.stop", id: m.id });
        await invoke({
          op: "transcript.save",
          id: m.id,
          version: 0,
          segments,
          speakers: { "chunk-1:speaker-0": "张三" },
        });
      },
      { segments, port: (server.address() as { port: number }).port },
    );
    await page
      .getByRole("button")
      .filter({ hasText: "说话人修复验收" })
      .click();
    const button = page.getByRole("button", { name: "自动统一说话人" });
    await expect(button).toBeEnabled();
    await page.getByLabel("片段 1", { exact: true }).fill("尚未保存");
    await expect(button).toBeDisabled();
    await page.getByLabel("片段 1", { exact: true }).fill(segments[0].text);
    await page.getByRole("button", { name: "保存校对" }).click();
    await expect(button).toBeEnabled();
    const count = page.getByLabel("实际发言人数（可选）");
    await count.fill("0");
    await expect(button).toBeDisabled();
    await count.fill("6");
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByText("v3", { exact: true })).toBeVisible();
    await expect(page.locator(".speakers input")).toHaveCount(1);
    expect(uploaded).toContain('name="expected_speakers"\r\n\r\n6');
    await expect(
      page.getByLabel("说话人 speaker-1", { exact: true }),
    ).toHaveValue("张三");
    await expect(page.locator(".metadata")).toContainText("1 位说话人");
    await expect(page.getByLabel("片段 1", { exact: true })).toHaveValue(
      segments[0].text,
    );
    await expect(
      page.locator(".segment").getByText("静音 / 非语音", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/speakers.png" });
    await page.evaluate(async () => {
      const invoke = (window as any).meeting.invoke;
      const state = await invoke({ op: "state" });
      const m = state.meetings[0];
      await invoke({
        op: "transcript.save",
        id: m.id,
        version: m.version,
        speakers: m.speakers,
        segments: [
          ...m.segments,
          {
            id: crypto.randomUUID(),
            start: 2.5,
            end: 3,
            speaker: "unresolved-1",
            text: "需要回听的短句",
          },
        ],
      });
    });
    await expect(
      page.getByText(
        "已识别 1 位说话人，另有 1 段发言待确认；待确认标签不代表新增参会者。",
      ),
    ).toBeVisible();
    const pending = page.getByLabel("说话人 unresolved-1", { exact: true });
    await expect(pending).toBeHidden();
    await page.getByText("待确认发言（1 段）", { exact: true }).click();
    await expect(pending).toBeVisible();
    await expect(page.locator(".metadata")).toContainText("1 位说话人");
    await page
      .getByLabel("合并说话人 unresolved-1", { exact: true })
      .selectOption("speaker-1");
    await page.getByRole("button", { name: "保存校对" }).click();
    await expect(
      page.getByText("待确认发言（1 段）", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("speaker and unresolved labels locate the first turn across pages without losing edits", async () => {
  const data = mkdtempSync(join(tmpdir(), "meeting-speaker-jump-e2e-"));
  const segments = Array.from({ length: 135 }, (_, i) => ({
    id: randomUUID(),
    start: i,
    end: i + 1,
    speaker:
      i === 65 || i === 90
        ? "speaker-2"
        : i === 125 || i === 130
          ? "unresolved-1"
          : "speaker-1",
    text: `第 ${i + 1} 段发言`,
  }));
  // Imported/corrected transcripts need not be ordered. Select the earliest
  // timestamp, and keep the exact segment when other speech overlaps it.
  segments[90].start = 50;
  segments[90].end = 51;
  segments[125].start = 50;
  segments[125].end = 51;
  const app = await electron.launch({
    args: [".", "--lang=zh-CN"],
    env: { ...process.env, MEETING_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.evaluate(async (segments) => {
      const invoke = (window as any).meeting.invoke;
      const m = await invoke({
        op: "meeting.create",
        title: "说话人定位验收",
        projectId: null,
      });
      await invoke({
        op: "transcript.save",
        id: m.id,
        version: 0,
        segments,
        speakers: { "speaker-2": "张三" },
      });
    }, segments);
    await page
      .getByRole("button")
      .filter({ hasText: "说话人定位验收" })
      .click();
    await page.getByLabel("片段 1", { exact: true }).fill("未保存的校对文字");
    const named = page.getByRole("button", {
      name: "定位 张三 的第一段发言",
      exact: true,
    });
    await named.click();
    const target = page.locator(`[id="${segments[90].id}"]`);
    await expect(target).toBeInViewport();
    await expect(target).toBeFocused();
    await expect(target).toHaveClass(/playing/);
    await expect(page.getByLabel("原文分页")).toContainText("61–120");
    await expect(page.getByLabel("片段 91", { exact: true })).toHaveValue(
      segments[90].text,
    );
    // Repeating the same lookup must scroll again, even without a page change.
    await named.click();
    await expect(target).toBeInViewport();
    await expect(target).toBeFocused();
    await page.getByText("待确认发言（2 段）", { exact: true }).click();
    const unresolved = page.getByRole("button", {
      name: "定位 待确认 1 的第一段发言",
      exact: true,
    });
    await unresolved.focus();
    await unresolved.press("Enter");
    const pending = page.locator(`[id="${segments[125].id}"]`);
    await expect(pending).toBeInViewport();
    await expect(pending).toBeFocused();
    await expect(pending).toHaveClass(/playing/);
    await expect(page.getByLabel("原文分页")).toContainText("121–135");
    await page.screenshot({ path: "test-results/speaker-jump.png" });
    await page
      .getByRole("button", { name: "定位 说话人 1 的第一段发言", exact: true })
      .click();
    await expect(page.getByLabel("片段 1", { exact: true })).toHaveValue(
      "未保存的校对文字",
    );
    await expect(page.getByRole("button", { name: "保存校对" })).toBeEnabled();
    await page.getByRole("button", { name: "保存校对" }).click();
    await expect(page.getByText("v2", { exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});
