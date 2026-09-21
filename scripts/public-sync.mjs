import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const publicIdentity = {
  name: "Meeting Recorder",
  email: "48530832+ldy5413@users.noreply.github.com",
};
const reviewedAssets = JSON.parse(
  readFileSync(new URL("./public-assets.json", import.meta.url), "utf8"),
);
const git = (cwd, args, options = {}) =>
  execFileSync("git", ["-C", cwd, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
const gitText = (cwd, args, options) =>
  git(cwd, args, options).toString("utf8").trim();

function inspectFile(path, bytes) {
  if (
    /(^|\/)(?:\.git|\.local|\.venv|node_modules|library|backups|release|data)(\/|$)/i.test(
      path,
    ) ||
    /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|dev-bridge\.json|settings\.json)$/i.test(
      path,
    ) ||
    /\.(?:mp4|webm|mkv|mov|wav|mp3|m4a|ogg|flac|srt|sqlite\w*|db|pem|key|p12|pfx|encrypted|onnx|safetensors|pt|pth|log)$/i.test(
      path,
    )
  )
    throw new Error(`Private data path cannot be published: ${path}`);

  const hash = createHash("sha256").update(bytes).digest("hex");
  if (Object.hasOwn(reviewedAssets, path)) {
    if (reviewedAssets[path] !== hash)
      throw new Error(
        `Binary asset changed; review and update its hash: ${path}`,
      );
    return;
  }
  if (
    bytes.includes(0) ||
    /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|7z|exe|dll)$/i.test(path)
  )
    throw new Error(`Unreviewed binary asset: ${path}`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (
    /[A-Z]:[\\/]+Users[\\/]+[^\s<>"'`]+|\/(?:Users|home)\/[^/\s<>"'`]+/i.test(
      text,
    )
  )
    throw new Error(`Personal home path in: ${path}`);
  const privateIPs =
    text.match(
      /(?<![\d.])(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?![\d.])/g,
    ) || [];
  const testIPs = [
    "10.1.2.3",
    "172.16.0.1",
    "172.20.0.10",
    "172.31.255.254",
    "192.168.2.1",
  ];
  if (
    privateIPs.some(
      (ip) =>
        !["tests/services.test.ts", "scripts/public-sync.mjs"].includes(path) ||
        !testIPs.includes(ip),
    )
  )
    throw new Error(`Non-example private network address in: ${path}`);
  if (path !== "package-lock.json") {
    const emails = text.match(/[\w.+%-]+@(?:[\w-]+\.)+[a-z]{2,}/gi) || [];
    if (
      emails.some(
        (email) =>
          !/^(?:[^@]+@(?:users\.noreply\.github\.com|example\.com|example\.org)|git@ssh\.github\.com)$/i.test(
            email,
          ),
      )
    )
      throw new Error(`Non-public email address in: ${path}`);
  }
}

// Only file bytes cross this boundary. No source commit, tag or Git directory is copied.
export function exportSnapshot(source, ref, destination) {
  mkdirSync(destination, { recursive: true });
  if (readdirSync(destination).length)
    throw new Error("Snapshot destination must be empty");
  const commit = gitText(source, ["rev-parse", "--verify", `${ref}^{commit}`]);
  const entries = git(source, ["ls-tree", "-rz", "--full-tree", commit])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
      if (!match)
        throw new Error("Only regular files can enter a public snapshot");
      const [, mode, oid, path] = match;
      if (
        path.includes("\\") ||
        path
          .split("/")
          .some(
            (part) =>
              !part ||
              part === "." ||
              part === ".." ||
              part.toLowerCase() === ".git",
          )
      )
        throw new Error("Unsafe snapshot path");
      return { mode, oid, path };
    });
  const objects = git(source, ["cat-file", "--batch"], {
    input: entries.map((e) => e.oid).join("\n") + "\n",
  });
  let offset = 0;
  for (const entry of entries) {
    const end = objects.indexOf(10, offset);
    const [oid, type, size] = objects
      .subarray(offset, end)
      .toString()
      .split(" ");
    if (oid !== entry.oid || type !== "blob")
      throw new Error("Invalid blob response");
    offset = end + 1;
    const bytes = objects.subarray(offset, offset + Number(size));
    offset += Number(size) + 1;
    inspectFile(entry.path, bytes);
    const target = join(destination, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, {
      mode: entry.mode === "100755" ? 0o755 : 0o644,
    });
  }
  return { commit, files: entries.length };
}

function scanSnapshot(directory) {
  execFileSync(
    process.env.GITLEAKS_BIN || "gitleaks",
    ["dir", directory, "--redact", "--no-banner", "--max-archive-depth", "3"],
    { stdio: "inherit" },
  );
}

export function syncPublic({
  source,
  ref,
  target,
  root,
  bootstrap = false,
  scan = scanSnapshot,
}) {
  if (!bootstrap && !/^[a-f0-9]{40}$/.test(root || ""))
    throw new Error("A verified public root commit is required");
  const temporary = mkdtempSync(join(tmpdir(), "meeting-public-"));
  try {
    const payload = join(temporary, "payload");
    const snapshot = exportSnapshot(source, ref, payload);
    scan(payload);
    const repository = join(temporary, "repository");
    mkdirSync(repository);
    git(repository, ["init", "--bare", "--quiet"]);
    git(repository, ["config", "core.autocrlf", "false"]);
    git(repository, ["config", "core.filemode", "false"]);
    const refs = gitText(repository, [
      "ls-remote",
      "--refs",
      "--heads",
      "--tags",
      target,
    ]);
    let parent;
    if (refs) {
      if (bootstrap)
        throw new Error("Bootstrap requires an empty remote repository");
      const lines = refs.split("\n");
      if (lines.length !== 1 || !lines[0].endsWith("\trefs/heads/master"))
        throw new Error(
          "Public remote must contain only the master branch, without tags",
        );
      git(repository, [
        "fetch",
        "--quiet",
        "--no-tags",
        target,
        "refs/heads/master",
      ]);
      parent = gitText(repository, ["rev-parse", "FETCH_HEAD"]);
      if (gitText(repository, ["rev-list", "--max-parents=0", parent]) !== root)
        throw new Error(
          "Public root differs; refusing to join private or unrelated history",
        );
      const metadata = gitText(repository, [
        "log",
        "--format=%an <%ae>|%cn <%ce>",
        parent,
      ]);
      const identity = `${publicIdentity.name} <${publicIdentity.email}>`;
      if (
        metadata.split("\n").some((line) => line !== `${identity}|${identity}`)
      )
        throw new Error(
          "Unexpected downstream author; review independent changes before synchronizing",
        );
    } else if (!bootstrap) {
      throw new Error(
        "Public remote is empty; bootstrap must be reviewed separately",
      );
    }
    git(repository, ["--work-tree", payload, "add", "--all", "--force"]);
    // Preserve source executable bits even when the exporter runs on Windows.
    const modes = git(source, ["ls-tree", "-rz", snapshot.commit])
      .toString("utf8")
      .split("\0")
      .filter((row) => row.startsWith("100755 "))
      .map((row) => row.split("\t")[1]);
    if (modes.length)
      git(repository, ["update-index", "--chmod=+x", "--", ...modes]);
    const tree = gitText(repository, ["write-tree"]);
    if (
      parent &&
      tree === gitText(repository, ["rev-parse", `${parent}^{tree}`])
    )
      return { ...snapshot, publicCommit: parent, root, changed: false };
    const version = JSON.parse(
      readFileSync(join(payload, "package.json"), "utf8"),
    ).version;
    if (!/^\d+\.\d+\.\d+$/.test(version))
      throw new Error("Invalid public version");
    const env = { ...process.env };
    for (const role of ["AUTHOR", "COMMITTER"]) {
      env[`GIT_${role}_NAME`] = publicIdentity.name;
      env[`GIT_${role}_EMAIL`] = publicIdentity.email;
      env[`GIT_${role}_DATE`] = new Date().toISOString();
    }
    const commit = gitText(
      repository,
      ["commit-tree", tree, ...(parent ? ["-p", parent] : [])],
      {
        input: `Publish source snapshot\n\nVersion: ${version}\n`,
        env,
      },
    );
    git(repository, [
      "push",
      "--porcelain",
      target,
      `${commit}:refs/heads/master`,
    ]);
    return {
      ...snapshot,
      publicCommit: commit,
      root: root || commit,
      changed: true,
    };
  } finally {
    if (
      dirname(temporary) !== resolve(tmpdir()) ||
      !basename(temporary).startsWith("meeting-public-")
    )
      throw new Error("Refusing to remove an unexpected staging path");
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [source, ref, target, root] = process.argv.slice(2);
  if (!source || !ref || !target || !root)
    throw new Error(
      "Usage: node scripts/public-sync.mjs <source> <commit> <target> <public-root>",
    );
  console.log(
    JSON.stringify(syncPublic({ source: resolve(source), ref, target, root })),
  );
}
