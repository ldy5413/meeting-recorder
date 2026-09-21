const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const resources = path.join(context.appOutDir, "resources", "local-asr");
  for (const file of fs.readdirSync(resources, { recursive: true })) {
    if (/\.onnx$|\.partial$|(^|[\\/])models([\\/]|$)/i.test(file))
      throw new Error(`Model weights must not enter the installer: ${file}`);
  }
};
