import { languageFixture, languageHttpFixture } from "./language-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { Store, checkEvidence, validateClaims } from "../electron/store";
import { Services } from "../electron/services";
import { visualGroups } from "../shared/visual";
import {
  EvidenceSchema,
  type Claim,
  type Job,
  type Meeting,
  type VisualFrame,
  type Settings,
} from "../shared/types";
import { backup, stageRestore } from "../electron/backup";
import { markdown } from "../electron/export";
import {
  mediaCommand,
  importMedia,
  extractFrames,
  frameDirectory,
  probeVideo,
  videoAudio,
} from "../electron/video";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "meeting-video-")),
    library = join(root, "library"),
    audio = join(library, "audio");
  mkdirSync(audio, { recursive: true });
  mkdirSync(join(library, "frames"));
  const store = new Store(join(library, "library.sqlite"));
  const meeting = store.createMeeting(
    "Video",
    store.createProject("Review").id,
  );
  const frame: VisualFrame = {
    id: randomUUID(),
    file: `${randomUUID()}.jpg`,
    start: 0,
    end: 20,
    title: "计划",
    text: "计划日期 9月20日，方案 B",
    uncertain: "",
    excluded: false,
    model: "vision",
    contentType: "content",
    parameters: [],
  };
  const segment = {
    id: randomUUID(),
    start: 5,
    end: 10,
    text: "这还是草案，日期尚未确定。",
    speaker: "speaker_0",
  };
  meeting.audio = `${meeting.id}.mp4`;
  meeting.video = {
    duration: 20,
    width: 1920,
    height: 1080,
    hasAudio: true,
    extracted: true,
    revision: 1,
    frames: [frame],
  };
  writeFileSync(join(audio, meeting.audio), "video");
  writeFileSync(join(library, "frames", frame.file), "image");
  store.put("meetings", meeting);
  store.saveTranscript(meeting.id, 0, [segment], {});
  return {
    root,
    library,
    audio,
    store,
    meeting: store.get<Meeting>("meetings", meeting.id),
    frame,
    segment,
  };
}
function claim(frame: VisualFrame): Claim {
  return {
    kind: "summary",
    text: "展示的日期为 9月20日，尚未确认",
    owner: null,
    due: null,
    targetId: null,
    change: "new",
    evidence: [{ frameId: frame.id, quote: "计划日期 9月20日" }],
  };
}

test("visual evidence cannot masquerade as speech or establish a decision, deadline or owner", () => {
  const { store, frame, segment } = fixture();
  try {
    const c = claim(frame);
    validateClaims([c], [segment], [], {}, [frame]);
    assert.throws(() => checkEvidence(c.evidence, [segment]));
    assert.throws(() =>
      checkEvidence(
        [{ segmentId: frame.id, quote: frame.text }],
        [segment],
        [frame],
      ),
    );
    assert.throws(() =>
      EvidenceSchema.parse({
        segmentId: segment.id,
        frameId: frame.id,
        quote: "x",
      }),
    );
    for (const changes of [
      { kind: "decision" },
      { kind: "todo" },
      { owner: "某人" },
      { due: "9月20日" },
      { change: "complete" },
    ])
      assert.throws(() =>
        validateClaims([{ ...c, ...changes } as Claim], [segment], [], {}, [
          frame,
        ]),
      );
    assert.throws(() =>
      checkEvidence(
        [{ frameId: frame.id, quote: "虚构数值" }],
        [segment],
        [frame],
      ),
    );
  } finally {
    store.close();
  }
});

test("time alignment includes speech before the first image, page boundaries and the end", () => {
  const frames = [20, 50, 80].map((start) => ({
    id: randomUUID(),
    file: `${randomUUID()}.jpg`,
    start,
    end: start + 30,
    title: "",
    text: "slide",
    uncertain: "",
    excluded: false,
  }));
  const segments = [0, 75, 115].map((start) => ({
    id: randomUUID(),
    start,
    end: start + 5,
    text: "speech",
    speaker: "s",
  }));
  const groups = visualGroups(segments, frames, 4000);
  assert.ok(groups[0].segments.some((s) => s.start === 0));
  assert.ok(groups.every((g) => g.segments.some((s) => s.start === 75)));
  assert.ok(groups[1].segments.some((s) => s.start === 115));
  assert.equal(groups[1].frames.length, 1);
  assert.throws(() => visualGroups(segments, frames, 10));
});

test("uncovered speech stays in audio-only groups instead of inheriting an old slide", () => {
  const { store, frame, segment } = fixture();
  try {
    const later = { ...segment, id: randomUUID(), start: 180, end: 190 };
    const groups = visualGroups([segment, later], [frame], 4000, 1);
    assert.ok(
      groups.find((g) => g.segments.some((s) => s.id === later.id))?.frames
        .length === 0,
    );
    assert.ok(
      groups.some(
        (g) =>
          g.frames.length === 1 && g.segments.some((s) => s.id === segment.id),
      ),
    );
  } finally {
    store.close();
  }
});

test("participant-only frames are classified and excluded without changing the transcript or original observation", async () => {
  const { store, meeting, audio, frame } = fixture();
  delete meeting.video!.frames[0].contentType;
  store.put("meetings", meeting);
  const services = new Services(
    store,
    audio,
    () => ({
      asrUrl: "http://localhost",
      baseUrl: "http://localhost",
      model: "vision",
      consent: true,
      visualConsent: true,
      contextBudget: 32768,
    }),
    () => "",
  );
  services.chat = async (_system, data) =>
    languageFixture(data) ?? {
      value: { contentType: "participants" },
      raw: '{"contentType":"participants"}',
    };
  try {
    const job = services.start(meeting.id, "visuals");
    while (services.controllers.size)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(store.get<Job>("jobs", job.id).status, "complete");
    const m = store.get<Meeting>("meetings", meeting.id);
    assert.equal(m.video!.frames[0].excluded, true);
    assert.equal(m.video!.frames[0].text, frame.text);
    assert.deepEqual(m.segments, meeting.segments);
    const analysis = services.start(meeting.id, "analyze", true);
    while (services.controllers.size)
      await new Promise((r) => setTimeout(r, 5));
    assert.match(store.get<Job>("jobs", analysis.id).error!, /没有可用于分析/);
    services.retry(analysis.id);
    while (services.controllers.size)
      await new Promise((r) => setTimeout(r, 5));
    assert.match(store.get<Job>("jobs", analysis.id).error!, /没有可用于分析/);
    assert.equal(store.get<Meeting>("meetings", meeting.id).analyses.length, 0);
  } finally {
    store.close();
  }
});

test("original-image review rejects false visual facts, retries failed work and preserves historical frame citations", async () => {
  const f = fixture();
  let failReview = true,
    reviewedWithImage = false,
    generated = 0;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const request = JSON.parse(body),
      content = request.messages[1].content;
    const input = JSON.parse(
      typeof content === "string" ? content : content[0].text,
    );
    if (languageHttpFixture(input, res)) return;
    let value: unknown;
    if (input.proposedClaims) {
      reviewedWithImage =
        Array.isArray(content) &&
        content[1].type === "image_url" &&
        request.model === "vision";
      if (failReview && input.frames) {
        res.writeHead(503).end();
        return;
      }
      value = {
        reviews: input.proposedClaims.map((_: any, index: number) => ({
          index,
          supported: index === 0,
          novel: true,
          reason: "对照发言与原图",
        })),
      };
    } else if (input.sections) value = { supported: true };
    else if (input.claims)
      value = {
        sections: [{ title: "展示内容", claimIndices: [0], children: [] }],
      };
    else if (!input.frames) value = { claims: [] };
    else {
      generated++;
      value = {
        claims: [
          {
            ...claim(f.frame),
            evidence: [
              ...claim(f.frame).evidence,
              { segmentId: f.segment.id, quote: f.segment.text },
            ],
          },
          {
            ...claim(f.frame),
            text: "日期已确定",
            evidence: claim(f.frame).evidence,
          },
        ],
      };
    }
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
  const settings: Settings = {
    asrUrl: "http://127.0.0.1",
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
    model: "text",
    visionModel: "vision",
    contextBudget: 65536,
    consent: true,
    visualConsent: false,
  };
  const services = new Services(
    f.store,
    f.audio,
    () => settings,
    () => "",
  );
  const wait = async () => {
    // Parallel CI tests share disk I/O; this verifies completion, not latency.
    const end = Date.now() + 30000;
    while (services.controllers.size) {
      if (Date.now() > end) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  try {
    assert.throws(() => services.start(f.meeting.id, "analyze", true), /画面/);
    settings.visualConsent = true;
    const job = services.start(f.meeting.id, "analyze", true);
    await wait();
    assert.equal(f.store.get<Job>("jobs", job.id).status, "failed");
    assert.equal(
      f.store.get<Meeting>("meetings", f.meeting.id).analyses.length,
      0,
    );
    failReview = false;
    services.retry(job.id);
    await wait();
    assert.equal(f.store.get<Job>("jobs", job.id).status, "complete");
    assert.ok(reviewedWithImage);
    assert.equal(generated, 2);
    const m = f.store.get<Meeting>("meetings", f.meeting.id),
      a = m.analyses[0];
    assert.equal(a.claims.length, 1);
    assert.equal(a.mode, "visual");
    assert.equal(a.visual?.frames.length, 1);
    assert.equal(f.store.all("records").length, 0);
    m.video!.frames[0].excluded = true;
    m.video!.revision++;
    f.store.put("meetings", m);
    assert.equal(
      f.store.resolveEvidence(a.claims[0].evidence[0]).frame?.file,
      f.frame.file,
    );
    const output = markdown(m, a.id);
    assert.match(output, /画面依据/);
    assert.match(output, new RegExp(`#f-${f.frame.id}`));
    assert.match(output, /分析已过期/);
    const archive = join(f.root, "backup.tar.gz");
    await backup(f.store, f.library, archive);
    const restored = new Store(
      join(await stageRestore(archive, f.library), "library.sqlite"),
    );
    assert.equal(
      restored.resolveEvidence(a.claims[0].evidence[0]).frame?.file,
      f.frame.file,
    );
    restored.close();
    const failed = {
      ...job,
      id: randomUUID(),
      status: "failed" as const,
      visualSnapshot: a.visual,
    };
    f.store.put("jobs", failed);
    services.retry(failed.id);
    await wait();
    assert.match(f.store.get<Job>("jobs", failed.id).error!, /画面已改变/);
  } finally {
    for (const id of services.controllers.keys()) await services.cancel(id);
    await wait();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    f.store.close();
  }
});

test("local media processing imports an actual video, extracts scene frames and audio without changing source", async (t) => {
  try {
    await mediaCommand("ffmpeg", ["-version"]);
  } catch {
    t.skip("FFmpeg not installed");
    return;
  }
  const f = fixture();
  try {
    const source = join(f.root, "synthetic.mp4");
    await mediaCommand("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=320x180:r=2:d=4",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x180:r=2:d=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=8",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
      "-map",
      "2:a",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      source,
    ]);
    const original = readFileSync(source),
      m = f.store.createMeeting("Synthetic", null);
    const imported = await importMedia(f.store, f.audio, m.id, source);
    assert.ok(imported.video?.hasAudio);
    assert.equal(imported.video?.width, 320);
    const frames = await extractFrames(
      join(f.audio, imported.audio!),
      frameDirectory(f.audio),
      imported.video!.duration,
      () => {},
    );
    assert.ok(frames.length >= 2);
    assert.equal(frames[0].start, 0);
    assert.ok(frames.some((frame) => frame.start >= 4));
    assert.ok(
      readFileSync(join(frameDirectory(f.audio), frames[0].file)).length > 100,
    );
    const audio = await videoAudio(f.audio, imported);
    assert.equal(readFileSync(audio).subarray(0, 4).toString(), "RIFF");
    assert.deepEqual(readFileSync(source), original);
    await assert.rejects(
      importMedia(f.store, f.audio, m.id, source),
      /新建会议/,
    );
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(mediaCommand("ffmpeg", ["-version"], ctrl.signal));
  } finally {
    f.store.close();
  }
});

test("frame extraction preserves the timeline when a recording changes resolution before an audio-only tail", async (t) => {
  try {
    await mediaCommand("ffmpeg", ["-version"]);
  } catch {
    t.skip("FFmpeg not installed");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "meeting-video-resize-"));
  // Like a resized screen capture: VP8 changes dimensions in one stream, and
  // audio outlasts the last video frame. A restarted fps filter pads from zero.
  for (const [name, size, color, duration] of [
    ["first", "320x180", "white", 13.1],
    ["second", "400x180", "black", 4],
    ["third", "180x320", "white", 2.7],
  ] as const) {
    await mediaCommand("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=${size}:r=10:d=${duration}`,
      "-c:v",
      "libvpx",
      "-deadline",
      "realtime",
      join(root, `${name}.webm`),
    ]);
  }
  const source = join(root, "resized.webm"),
    list = join(root, "parts.txt");
  writeFileSync(
    list,
    "file 'first.webm'\nfile 'second.webm'\nfile 'third.webm'\n",
  );
  await mediaCommand("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=20.1",
    "-c:v",
    "copy",
    "-c:a",
    "libopus",
    source,
  ]);
  const original = readFileSync(source),
    video = await probeVideo(source);
  assert.ok(video && video.duration > 20);
  const directory = join(root, "frames");
  const frames = await extractFrames(
    source,
    directory,
    video.duration,
    () => {},
  );
  assert.deepEqual(
    frames.map((frame) => frame.start),
    [0, 14, 18],
  );
  assert.equal(frames.at(-1)!.end, video.duration);
  for (const [index, dimensions] of [
    [320, 180],
    [400, 180],
    [180, 320],
  ].entries()) {
    const file = join(directory, frames[index].file);
    const raw = await mediaCommand("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      file,
    ]);
    const image = JSON.parse(raw.toString()).streams[0];
    assert.deepEqual([image.width, image.height], dimensions);
    const pixels = await mediaCommand("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      "scale=1:1,format=gray",
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    assert.ok(index === 1 ? pixels[0] < 10 : pixels[0] > 245);
  }
  assert.deepEqual(readFileSync(source), original);
});
