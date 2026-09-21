import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import catalog from "../shared/asr-models.json";
import type { AsrModelState } from "../shared/types";

type Language = "zh" | "en";
type Asset = { bytes: number; sha256: string; url: string; group: string };
type Catalog = { version: string; files: Record<string, Asset> };

/** Downloads are serialized; only verified files replace the cache's final files. */
export class AsrModels {
  private tail: Promise<unknown> = Promise.resolve();
  private manual = new Map<Language, AbortController>();
  private states: Partial<
    Record<Language, Pick<AsrModelState, "status" | "error">>
  > = {};
  constructor(
    public directory: string,
    private assets: Catalog = catalog,
    private fetcher: typeof fetch = fetch,
  ) {
    for (const [name, asset] of Object.entries(assets.files)) {
      if (
        !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name) ||
        name.split("/").some((part) => part === "." || part === "..") ||
        !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        asset.bytes <= 0
      )
        throw new Error("Invalid model catalog");
    }
  }

  private files(language: Language, speakersOnly = false) {
    return Object.entries(this.assets.files).filter(([name, asset]) =>
      speakersOnly
        ? name === "campplus.onnx"
        : asset.group === "shared" || asset.group === language,
    );
  }

  snapshot(): AsrModelState[] {
    return (["zh", "en"] as const).map((language) => {
      let downloadedBytes = 0,
        bytes = 0,
        ready = true;
      for (const [name, asset] of this.files(language)) {
        bytes += asset.bytes;
        const path = join(this.directory, name);
        const size = (file: string) => {
          try {
            return statSync(file).size;
          } catch {
            return 0;
          }
        };
        if (size(path) === asset.bytes) downloadedBytes += asset.bytes;
        else {
          ready = false;
          downloadedBytes += Math.min(asset.bytes, size(path + ".partial"));
        }
      }
      const current = this.states[language];
      return {
        language,
        bytes,
        downloadedBytes,
        status:
          current?.status === "ready" || !current
            ? ready
              ? "ready"
              : "missing"
            : current.status,
        error: current?.error,
        canCancel: this.manual.has(language),
      };
    });
  }

  start(language: Language) {
    if (
      this.manual.has(language) ||
      ["queued", "checking", "downloading"].includes(
        this.states[language]?.status ?? "",
      )
    )
      return;
    const controller = new AbortController();
    this.manual.set(language, controller);
    void this.ensure(language, false, controller.signal)
      .catch(() => {})
      .finally(() => {
        if (this.manual.get(language) === controller)
          this.manual.delete(language);
      });
  }
  cancel(language: Language) {
    this.manual.get(language)?.abort();
  }
  close() {
    this.manual.forEach((controller) => controller.abort());
  }

  ensure(
    language: Language,
    speakersOnly: boolean,
    signal: AbortSignal,
    progress = (_: string) => {},
  ) {
    signal.throwIfAborted();
    this.states[language] = { status: "queued" };
    let started = false;
    const result = this.tail
      .catch(() => {})
      .then(async () => {
        started = true;
        try {
          signal.throwIfAborted();
          this.states[language] = { status: "checking" };
          progress("检查本地模型");
          await mkdir(this.directory, { recursive: true });
          const files = this.files(language, speakersOnly);
          const total = files.reduce((sum, [, asset]) => sum + asset.bytes, 0);
          let done = 0,
            last = 0;
          for (const [name, asset] of files) {
            signal.throwIfAborted();
            const path = join(this.directory, name);
            if (!(await this.valid(path, asset, signal))) {
              this.states[language] = { status: "downloading" };
              await this.download(path, asset, signal, (received) => {
                if (Date.now() - last > 500 || received === asset.bytes) {
                  last = Date.now();
                  progress(
                    `下载语音模型 ${Math.floor((100 * (done + received)) / total)}%（${Math.round((done + received) / 1e6)}/${Math.round(total / 1e6)} MB）`,
                  );
                }
              });
            }
            done += asset.bytes;
          }
          signal.throwIfAborted();
          const manifest = join(this.directory, "manifest.json");
          const content = JSON.stringify(this.assets);
          if (!(
            existsSync(manifest) &&
            (await readFile(manifest, "utf8")) === content
          )) {
            await writeFile(manifest + ".tmp", content);
            await rename(manifest + ".tmp", manifest);
          }
          this.states[language] = { status: "ready" };
          return this.directory;
        } catch (error) {
          this.states[language] = {
            status: signal.aborted ? "cancelled" : "failed",
            error: String((error as Error).message || error),
          };
          if (signal.aborted) throw new Error("模型下载已取消");
          throw new Error(
            `语音模型下载失败，请检查网络后重试：${(error as Error).message}`,
          );
        }
      });
    this.tail = result.catch(() => {});
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        if (!started) {
          this.states[language] = { status: "cancelled" };
          reject(new Error("模型下载已取消"));
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      void result
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }

  private async valid(path: string, asset: Asset, signal: AbortSignal) {
    try {
      if ((await stat(path)).size !== asset.bytes) return false;
    } catch {
      return false;
    }
    const hash = createHash("sha256");
    for await (const block of createReadStream(path)) {
      signal.throwIfAborted();
      hash.update(block);
    }
    return hash.digest("hex") === asset.sha256;
  }

  private async download(
    path: string,
    asset: Asset,
    signal: AbortSignal,
    progress: (bytes: number) => void,
  ) {
    await mkdir(dirname(path), { recursive: true });
    const partial = path + ".partial";
    let offset = await stat(partial).then(
      (s) => s.size,
      () => 0,
    );
    if (offset >= asset.bytes) {
      if (
        offset === asset.bytes &&
        (await this.valid(partial, asset, signal))
      ) {
        await rename(partial, path);
        progress(asset.bytes);
        return;
      }
      await rm(partial, { force: true });
      offset = 0;
    }
    const timeout = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const keepAlive = () => {
      clearTimeout(timer);
      timer = setTimeout(() => timeout.abort(new Error("模型下载超时")), 60000);
    };
    keepAlive();
    const downloadSignal = AbortSignal.any([signal, timeout.signal]);
    try {
      const response = await this.fetcher(asset.url, {
        signal: downloadSignal,
        credentials: "omit",
        headers: offset ? { Range: `bytes=${offset}-` } : {},
      });
      if (!response.ok || !response.body)
        throw new Error(`HTTP ${response.status}`);
      if (response.status === 206) {
        const range = response.headers.get("content-range");
        if (range !== `bytes ${offset}-${asset.bytes - 1}/${asset.bytes}`) {
          await response.body.cancel();
          throw new Error("模型下载范围不一致");
        }
      } else if (response.status === 200) offset = 0;
      else {
        await response.body.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const file = await open(partial, offset ? "a" : "w");
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value: block } = await reader.read();
          if (done) break;
          downloadSignal.throwIfAborted();
          keepAlive();
          if (offset + block.byteLength > asset.bytes)
            throw new Error("模型文件大小不一致");
          // FileHandle.write can write fewer bytes than requested.
          let written = 0;
          while (written < block.byteLength) {
            const result = await file.write(
              block,
              written,
              block.byteLength - written,
            );
            if (!result.bytesWritten) throw new Error("模型文件写入失败");
            written += result.bytesWritten;
          }
          offset += block.byteLength;
          progress(offset);
        }
        await file.sync();
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        await file.close();
      }
      signal.throwIfAborted();
      if (offset !== asset.bytes) throw new Error("模型下载未完成");
      if (!(await this.valid(partial, asset, signal))) {
        await rm(partial, { force: true });
        throw new Error("模型完整性校验失败");
      }
      await rename(partial, path);
    } finally {
      clearTimeout(timer!);
      timeout.abort();
    }
  }
}
