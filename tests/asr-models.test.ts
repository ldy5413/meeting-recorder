import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsrModels } from "../electron/asr-models";

async function fixture(
  mode: "range" | "ignore" | "corrupt" | "slow" = "range",
) {
  const requests: { name: string; range?: string }[] = [];
  const bodies = {
    "campplus.onnx": Buffer.alloc(10000, 17),
    "sensevoice.int8.onnx": Buffer.alloc(160000, 42),
    "qwen3/encoder.int8.onnx": Buffer.alloc(80000, 53),
  };
  const server = createServer((req, res) => {
    const name = req.url!.slice(1) as keyof typeof bodies;
    requests.push({ name, range: req.headers.range });
    const data = bodies[name];
    if (!data) {
      res.writeHead(404).end();
      return;
    }
    const offset =
      mode !== "ignore" && req.headers.range
        ? Number(req.headers.range.match(/\d+/)![0])
        : 0;
    if (offset)
      res.writeHead(206, {
        "Content-Range": `bytes ${offset}-${data.length - 1}/${data.length}`,
      });
    else res.writeHead(200);
    const payload =
      mode === "corrupt"
        ? Buffer.alloc(data.length, 99)
        : data.subarray(offset);
    if (mode !== "slow") res.end(payload);
    else {
      let done = 0;
      const timer = setInterval(() => {
        res.write(payload.subarray(done, done + 4000));
        done += 4000;
        if (done >= payload.length) {
          clearInterval(timer);
          res.end();
        }
      }, 10);
      res.on("close", () => clearInterval(timer));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const directory = await mkdtemp(join(tmpdir(), "meeting-model-download-"));
  const assets = {
    version: "test",
    files: Object.fromEntries(
      Object.entries(bodies).map(([name, body]) => [
        name,
        {
          bytes: body.length,
          sha256: createHash("sha256").update(body).digest("hex"),
          url: `http://127.0.0.1:${port}/${name}`,
          group: name.startsWith("qwen3/")
            ? "zh"
            : name === "campplus.onnx"
              ? "shared"
              : "en",
        },
      ]),
    ),
  };
  return {
    directory,
    assets,
    bodies,
    requests,
    models: new AsrModels(directory, assets),
    setMode: (value: typeof mode) => {
      mode = value;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("models download by language, share common assets and remain usable offline after restart", async () => {
  const f = await fixture();
  try {
    const signal = new AbortController().signal;
    await Promise.all([
      f.models.ensure("en", false, signal),
      f.models.ensure("zh", false, signal),
    ]);
    assert.equal(f.requests.length, 3);
    assert.deepEqual(
      f.models.snapshot().map((s) => s.status),
      ["ready", "ready"],
    );
    const offline = new AsrModels(f.directory, f.assets, async () => {
      throw new Error("offline");
    });
    await offline.ensure("en", false, signal);
    await offline.ensure("zh", false, signal);
    assert.equal(
      JSON.parse(await readFile(join(f.directory, "manifest.json"), "utf8"))
        .version,
      "test",
    );
  } finally {
    await f.close();
  }
});

for (const mode of ["range", "ignore"] as const)
  test(`partial model resumes safely when server uses ${mode}`, async () => {
    const f = await fixture(mode);
    try {
      const name = "sensevoice.int8.onnx";
      await writeFile(
        join(f.directory, name + ".partial"),
        f.bodies[name].subarray(0, 30000),
      );
      await f.models.ensure("en", false, new AbortController().signal);
      assert.equal(
        f.requests.find((r) => r.name === name)?.range,
        "bytes=30000-",
      );
      assert.deepEqual(await readFile(join(f.directory, name)), f.bodies[name]);
    } finally {
      await f.close();
    }
  });

test("corrupt downloads are rejected; retry repairs same-size corrupt cache files", async () => {
  const f = await fixture("corrupt");
  try {
    const signal = new AbortController().signal;
    await assert.rejects(
      f.models.ensure("en", false, signal),
      /完整性校验失败/,
    );
    await assert.rejects(stat(join(f.directory, "campplus.onnx")), {
      code: "ENOENT",
    });
    assert.equal(
      f.models.snapshot().find((s) => s.language === "en")?.status,
      "failed",
    );
    f.setMode("range");
    await f.models.ensure("en", false, signal);
    await writeFile(
      join(f.directory, "sensevoice.int8.onnx"),
      Buffer.alloc(160000),
    );
    await f.models.ensure("en", false, signal);
    assert.deepEqual(
      await readFile(join(f.directory, "sensevoice.int8.onnx")),
      f.bodies["sensevoice.int8.onnx"],
    );
  } finally {
    await f.close();
  }
});

test("cancellation preserves partial bytes, never publishes partial models, and retry resumes", async () => {
  const f = await fixture("slow");
  try {
    const controller = new AbortController();
    await assert.rejects(
      f.models.ensure("en", false, controller.signal, (step) => {
        if (step.startsWith("下载语音模型")) controller.abort();
      }),
      /已取消/,
    );
    await assert.rejects(stat(join(f.directory, "campplus.onnx")), {
      code: "ENOENT",
    });
    const partial = (await stat(join(f.directory, "campplus.onnx.partial")))
      .size;
    assert.ok(partial > 0 && partial < 10000);
    f.setMode("range");
    await f.models.ensure("en", false, new AbortController().signal);
    assert.equal(f.requests[1].range, `bytes=${partial}-`);
  } finally {
    await f.close();
  }
});

test("model catalog cannot write outside its cache", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.directory, "unused"));
    assert.throws(
      () =>
        new AsrModels(f.directory, {
          version: "test",
          files: { "../escape.onnx": f.assets.files["campplus.onnx"] },
        }),
      /Invalid model catalog/,
    );
  } finally {
    await f.close();
  }
});
