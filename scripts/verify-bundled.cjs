const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== "win32") return;
  const root = context.packager.projectDir;
  const bundle = path.join(root, ".local/bundled");
  for (const file of [
    "local-asr/worker/meeting-asr.exe",
    "local-asr/model-catalog.json",
    "local-asr/source-manifest.json",
    "media/ffmpeg.exe",
    "media/ffprobe.exe",
  ]) {
    if (!fs.existsSync(path.join(bundle, file)))
      throw new Error(
        `Missing bundled asset ${file}; run npm run prepare:local-asr`,
      );
  }
  const sources = JSON.parse(
    fs.readFileSync(
      path.join(bundle, "local-asr/source-manifest.json"),
      "utf8",
    ),
  );
  for (const [file, expected] of Object.entries(sources)) {
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(root, file)))
      .digest("hex");
    if (actual !== expected)
      throw new Error(
        `Bundled worker is stale: ${file}; run npm run prepare:local-asr`,
      );
  }
  const content = fs.readFileSync(
    path.join(bundle, "local-asr/model-catalog.json"),
    "utf8",
  );
  const manifest = JSON.parse(content);
  if (
    content !==
    fs.readFileSync(path.join(root, "shared/asr-models.json"), "utf8")
  )
    throw new Error(
      "Bundled model catalog is stale; run npm run prepare:local-asr",
    );
  if (Object.keys(manifest.files).length !== 11)
    throw new Error("Unexpected bundled model inventory");
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (
      !/^[a-f0-9]{64}$/.test(expected.sha256) ||
      expected.bytes <= 0 ||
      !expected.url.startsWith("https://")
    )
      throw new Error(`Invalid model catalog entry: ${file}`);
  }
};
