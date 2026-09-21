import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDevBridge } from "../electron/dev-bridge";

test("development browser transport requires credentials and exact origin and streams only known audio", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meeting-dev-bridge-"));
  writeFileSync(join(directory, "index.html"), "<h1>Local UI</h1>");
  writeFileSync(join(directory, "clip.wav"), "0123456789");
  writeFileSync(join(directory, "frame.jpg"), "image-bytes");
  let calls = 0;
  const server = await startDevBridge({
    dist: directory,
    userData: directory,
    dispatch: async (input) => {
      calls++;
      return { ok: true, value: input };
    },
    audio: (name) => (name === "clip.wav" ? join(directory, name) : undefined),
    frame: (name) => (name === "frame.jpg" ? join(directory, name) : undefined),
  });
  try {
    const { origin, token } = JSON.parse(
      readFileSync(join(directory, "dev-bridge.json"), "utf8"),
    );
    const headers = {
      Origin: origin,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const request = (extra: Record<string, string>) =>
      fetch(`${origin}/api/request`, {
        method: "POST",
        headers: extra,
        body: JSON.stringify({ op: "state" }),
      });
    assert.equal(
      (await request({ Origin: origin, "Content-Type": "application/json" }))
        .status,
      403,
    );
    assert.equal(
      (await request({ ...headers, Origin: "http://evil.example" })).status,
      403,
    );
    assert.equal(
      (
        await request({
          Authorization: headers.Authorization,
          "Content-Type": "application/json",
        })
      ).status,
      403,
    );
    assert.equal(calls, 0);
    assert.deepEqual(await (await request(headers)).json(), {
      ok: true,
      value: { op: "state" },
    });
    assert.equal(calls, 1);
    assert.equal((await fetch(`${origin}/frames/frame.jpg`)).status, 403);
    const frame = await fetch(`${origin}/frames/frame.jpg`, { headers });
    assert.equal(frame.headers.get("content-type"), "image/jpeg");
    assert.equal(await frame.text(), "image-bytes");
    assert.equal(
      (await fetch(`${origin}/frames/unknown.jpg`, { headers })).status,
      404,
    );
    const bootstrap = await fetch(`${origin}/?token=${token}`, {
      redirect: "manual",
    });
    assert.equal(bootstrap.status, 303);
    assert.match(
      bootstrap.headers.get("set-cookie")!,
      /HttpOnly; SameSite=Strict/,
    );
    assert.equal(bootstrap.headers.get("location"), "/");
    const audio = await fetch(`${origin}/audio/clip.wav`, {
      headers: { ...headers, Range: "bytes=3-5" },
    });
    assert.equal(audio.status, 206);
    assert.equal(audio.headers.get("content-range"), "bytes 3-5/10");
    assert.equal(await audio.text(), "345");
    assert.equal(
      (await fetch(`${origin}/audio/unknown.wav`, { headers })).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${origin}/audio/clip.wav`, {
          headers: { ...headers, Range: "bytes=99-" },
        })
      ).status,
      416,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // The directory is a unique, verified temp directory created by this test.
    rmSync(directory, { recursive: true, force: true });
  }
});
