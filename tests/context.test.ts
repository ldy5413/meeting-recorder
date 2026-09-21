import { languageFixture } from "./language-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store, validateClaims } from "../electron/store";
import { Services } from "../electron/services";
import {
  analysisMarkdown,
  contextOf,
  mergeApprovedClaims,
} from "../shared/analysis";
import type { Job, Meeting, Settings, Claim } from "../shared/types";

test("corrected identity supports self commitments and deduplication preserves different people", () => {
  const segments = ["a", "b", "c"].map((speaker) => ({
    id: randomUUID(),
    speaker,
    start: 0,
    end: 1,
    text: "我下周增加测试。",
  }));
  const speakers = { a: "张三", b: "李四", c: "张三" };
  const claims: Claim[] = segments.map((s) => ({
    kind: "todo",
    text: "增加测试",
    owner: speakers[s.speaker as keyof typeof speakers],
    due: null,
    change: "new",
    targetId: null,
    evidence: [{ segmentId: s.id, quote: s.text }],
  }));
  assert.throws(() => validateClaims(claims, segments, []), /负责人/);
  validateClaims(claims, segments, [], speakers);
  assert.throws(
    () =>
      validateClaims([{ ...claims[0], owner: "王五" }], segments, [], speakers),
    /负责人/,
  );
  const merged = mergeApprovedClaims(claims, segments, speakers);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].evidence.length, 2);
  assert.equal(merged[1].owner, "李四");
});

test("batched facts organize once, unknown people remain unknown, retry freezes configuration and history", async () => {
  const root = mkdtempSync(join(tmpdir(), "meeting-context-"));
  const store = new Store(join(root, "db.sqlite"));
  const m = store.createMeeting("周会", null);
  const segments = Array.from({ length: 12 }, (_, i) => ({
    id: randomUUID(),
    start: i * 10,
    end: i * 10 + 9,
    speaker: i < 8 ? `window-${i}` : "speaker-3",
    text: `本周完成模块${i}。` + "本段讨论技术细节。".repeat(25),
  }));
  const speakers = Object.fromEntries(
    segments.slice(0, 8).map((s, i) => [s.speaker, i % 2 ? "李四" : "张三"]),
  );
  store.saveTranscript(m.id, 0, segments, speakers);
  store.configure("meetings", m.id, {
    ...contextOf(),
    templateId: "weekly",
    background: "计划上线尚未讨论",
    keywords: ["XRD"],
  });
  const settings: Settings = {
    consent: true,
    asrUrl: "http://localhost",
    baseUrl: "http://localhost",
    model: "test",
    contextBudget: 12000,
  };
  const services = new Services(
    store,
    root,
    () => settings,
    () => "",
  );
  let failOrganization = true,
    generations = 0,
    organizations = 0;
  services.chat = async (_system, input) => {
    const language = languageFixture(input);
    if (language) return language;
    const data = input as any;
    let value: any;
    if (data.sections) value = { supported: true };
    else if (data.claims) {
      organizations++;
      if (failOrganization) {
        failOrganization = false;
        throw new Error("temporary organization failure");
      }
      if (data.template.id === "weekly") {
        assert.equal(data.context.background, "计划上线尚未讨论");
        assert.deepEqual(data.speakers, speakers);
        value = {
          assignments: data.claims.map((c: any, index: number) => {
            const s = segments.find((s) => s.id === c.evidence[0].segmentId)!;
            return {
              index,
              person: data.speakers[s.speaker] || null,
              column: "progress",
            };
          }),
        };
      } else
        value = {
          sections: [
            {
              title: "项目进展",
              claimIndices: data.claims.map((_: unknown, i: number) => i),
              children: [],
            },
          ],
        };
    } else if (data.proposedClaims) {
      value = {
        reviews: data.proposedClaims.map((_: unknown, index: number) => ({
          index,
          supported: true,
          reason: "直接证据充分",
        })),
      };
    } else {
      generations++;
      value = {
        claims: data.segments.map((s: any) => ({
          kind: "topic",
          text: s.text.split("。")[0],
          owner: null,
          due: null,
          targetId: null,
          change: "new",
          evidence: [{ segmentId: s.id, quote: s.text.split("。")[0] }],
        })),
      };
    }
    return { raw: JSON.stringify(value), value };
  };
  const wait = async () => {
    while (services.controllers.size)
      await new Promise((r) => setTimeout(r, 5));
  };
  try {
    const job = services.start(m.id, "analyze");
    await wait();
    assert.equal(store.get<Job>("jobs", job.id).status, "failed");
    const extractedBatches = generations;
    assert.ok(extractedBatches > 1);
    store.configure("meetings", m.id, {
      ...contextOf(),
      background: "已修改背景",
    });
    services.retry(job.id);
    await wait();
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    assert.equal(generations, extractedBatches);
    const weekly = store.get<Meeting>("meetings", m.id).analyses[0];
    assert.deepEqual(
      weekly.sections!.map((s) => s.title),
      ["张三", "李四", "speaker-3"],
    );
    assert.equal(weekly.claims.length, 12);
    assert.match(analysisMarkdown(weekly), /### speaker-3/);
    assert.match(analysisMarkdown(weekly), new RegExp(`#s-${segments[0].id}`));
    assert.ok(!analysisMarkdown(weekly).includes("上线"));
    const second = services.start(m.id, "analyze");
    await wait();
    assert.equal(store.get<Job>("jobs", second.id).status, "complete");
    const history = store.get<Meeting>("meetings", m.id).analyses;
    assert.equal(history.length, 2);
    assert.equal(history[1].sections![0].title, "项目进展");
    assert.deepEqual(history[0], weekly);
    assert.equal(organizations, 3);
  } finally {
    store.close();
  }
});
