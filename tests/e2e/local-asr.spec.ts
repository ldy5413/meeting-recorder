import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Store } from "../../electron/store";
import { contextOf } from "../../shared/analysis";

test("downloaded Chinese/English models work without service consent or Python PATH", async () => {
  test.skip(
    process.env.MEETING_REAL_ASR_E2E !== "1",
    "Explicit real CPU/model integration check",
  );
  test.setTimeout(600000);
  const samples = resolve(
    ".local/lightweight-asr/candidates/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/test_wavs",
  );
  const data = process.env.MEETING_ASR_E2E_DATA
    ? resolve(process.env.MEETING_ASR_E2E_DATA)
    : mkdtempSync(join(tmpdir(), "meeting-local-asr-e2e-"));
  const audio = join(data, "library/audio");
  mkdirSync(audio, { recursive: true });
  const store = new Store(join(data, "library/library.sqlite"));
  const meetings = [
    { language: "zh" as const, title: "本地中文转写验收", file: "qiqiu1.wav" },
    {
      language: "en" as const,
      title: "Local English transcription",
      file: "noise1-en.wav",
    },
  ].map(({ language, title, file }) => {
    const m = store.createMeeting(title, null);
    m.title += ` ${m.id.slice(0, 8)}`;
    m.audio = `${m.id}.wav`;
    m.status = "ready";
    m.context = { ...contextOf(), transcriptionLanguage: language };
    if (!existsSync(join(samples, file)))
      throw new Error("Run npm run prepare:local-asr first");
    copyFileSync(join(samples, file), join(audio, m.audio));
    store.put("meetings", m);
    return m;
  });
  store.close();
  const packaged = process.env.MEETING_PACKAGED_EXE;
  if (packaged)
    expect(
      existsSync(
        join(dirname(resolve(packaged)), "resources/local-asr/models"),
      ),
    ).toBe(false);
  const app = await electron.launch({
    ...(packaged
      ? { executablePath: resolve(packaged), args: ["--lang=zh-CN"] }
      : { args: [".", "--lang=zh-CN"] }),
    env: {
      ...process.env,
      MEETING_DATA_DIR: data,
      PATH: join(process.env.SystemRoot!, "System32"),
      PYTHONPATH: "",
    },
  });
  const log = join(data, "electron-e2e.log");
  app.process().stderr?.on("data", (chunk) => appendFileSync(log, chunk));
  app
    .process()
    .on("exit", (code, signal) =>
      appendFileSync(log, `\nExit ${code} ${signal}\n`),
    );
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const initial = await page.evaluate(() =>
      (window as any).meeting.invoke({ op: "state" }),
    );
    expect(initial.settings.asrMode).toBe("local");
    expect(initial.settings.consent).toBe(false);
    // Exercise the settings download path before the English transcription.
    await page.getByRole("button", { name: "服务与备份" }).click();
    const englishModel = page.getByRole("region", {
      name: "英文 · SenseVoice",
    });
    await expect(englishModel).toBeVisible();
    if (
      initial.asrModels.find((m: any) => m.language === "en").status !== "ready"
    ) {
      await englishModel.getByRole("button").click();
      await expect
        .poll(
          async () => {
            const state = await page.evaluate(() =>
              (window as any).meeting.invoke({ op: "state" }),
            );
            const model = state.asrModels.find((m: any) => m.language === "en");
            if (model.status === "failed") throw new Error(model.error);
            return model.status;
          },
          { timeout: 240000 },
        )
        .toBe("ready");
    }
    await expect(
      englishModel.getByRole("button", { name: "已下载" }),
    ).toBeDisabled();
    await page.screenshot({
      path: "test-results/asr-model-downloads.png",
      fullPage: true,
    });
    for (const m of meetings) {
      await page.getByRole("button", { name: /^会议库/ }).click();
      await page.getByRole("button").filter({ hasText: m.title }).click();
      const language = page.getByRole("combobox", {
        name: "转写语言",
        exact: true,
      });
      await expect(language).toHaveValue(m.context!.transcriptionLanguage!);
      await page.getByRole("button", { name: "分说话人转录" }).click();
      await expect
        .poll(
          async () => {
            const state = await page.evaluate(() =>
              (window as any).meeting.invoke({ op: "state" }),
            );
            const job = state.jobs.find((j: any) => j.meetingId === m.id);
            if (job?.status === "failed") throw new Error(job.error);
            return job?.status;
          },
          { timeout: 300000 },
        )
        .toBe("complete");
      const saved = await page.evaluate(
        (id) =>
          (window as any).meeting
            .invoke({ op: "state" })
            .then((s: any) => s.meetings.find((m: any) => m.id === id)),
        m.id,
      );
      expect(saved.version).toBe(1);
      expect(saved.segments.length).toBeGreaterThan(0);
      expect(saved.segments.map((s: any) => s.text).join(" ")).toMatch(
        m.context!.transcriptionLanguage === "zh"
          ? /[\u4e00-\u9fff]/
          : /[a-zA-Z]{3}/,
      );
      await expect(page.locator("article.segment").first()).toBeVisible();
    }
    // Repair uses the bundled speaker model and preserves existing words and evidence IDs.
    const m = meetings[1];
    const beforeRepair = await page.evaluate(
      (id) =>
        (window as any).meeting
          .invoke({ op: "state" })
          .then((s: any) => s.meetings.find((m: any) => m.id === id)),
      m.id,
    );
    await page.getByRole("button", { name: "自动统一说话人" }).click();
    await expect
      .poll(
        async () => {
          const state = await page.evaluate(() =>
            (window as any).meeting.invoke({ op: "state" }),
          );
          const job = state.jobs.find(
            (j: any) => j.meetingId === m.id && j.kind === "speakers",
          );
          if (job?.status === "failed") throw new Error(job.error);
          return state.meetings.find((meeting: any) => meeting.id === m.id)
            .version;
        },
        { timeout: 30000 },
      )
      .toBe(2);
    const repaired = await page.evaluate(
      (id) =>
        (window as any).meeting
          .invoke({ op: "state" })
          .then((s: any) => s.meetings.find((m: any) => m.id === id)),
      m.id,
    );
    const evidence = (s: any) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      text: s.text,
    });
    expect(repaired.segments.map(evidence)).toEqual(
      beforeRepair.segments.map(evidence),
    );
    await expect(page.getByText("v2", { exact: true })).toBeVisible();
    // A second transcription is cancelled while preserving the already saved transcript.
    const job = await page.evaluate(
      (id) =>
        (window as any).meeting.invoke({
          op: "job.start",
          id,
          kind: "transcribe",
        }),
      m.id,
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              (window as any).meeting
                .invoke({ op: "state" })
                .then((s: any) => s.jobs.find((j: any) => j.id === id).step),
            job.id,
          ),
        { timeout: 30000, intervals: [100] },
      )
      .toMatch(/本机识别说话人/);
    await page.evaluate(
      (id) => (window as any).meeting.invoke({ op: "job.cancel", id }),
      job.id,
    );
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            (window as any).meeting
              .invoke({ op: "state" })
              .then((s: any) => s.jobs.find((j: any) => j.id === id).status),
          job.id,
        ),
      )
      .toBe("cancelled");
    const after = await page.evaluate(
      (id) =>
        (window as any).meeting
          .invoke({ op: "state" })
          .then((s: any) => s.meetings.find((m: any) => m.id === id)),
      m.id,
    );
    expect(after.version).toBe(2);
    expect(after.segments).toEqual(repaired.segments);
    await expect(
      page.getByRole("button", { name: "分说话人转录" }),
    ).toBeEnabled();
    expect(errors).toEqual([]);
    await page.screenshot({
      path: "test-results/local-asr-desktop.png",
      fullPage: true,
    });
  } finally {
    await app.close();
  }
});
