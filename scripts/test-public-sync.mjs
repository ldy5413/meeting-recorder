import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { exportSnapshot, publicIdentity, syncPublic } from "./public-sync.mjs";

const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "public-sync-test-"));
  t.after(() => {
    assert.equal(dirname(dir), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("public-sync-test-"));
    rmSync(dir, { recursive: true, force: true });
  });
  const source = join(dir, "source"),
    target = join(dir, "downstream.git");
  mkdirSync(source);
  git(source, "init", "-q", "-b", "master");
  git(source, "config", "user.name", "Private Author");
  git(source, "config", "user.email", "person" + "@" + "company.invalid");
  git(source, "config", "commit.gpgsign", "false");
  git(source, "config", "core.autocrlf", "false");
  git(source, "init", "--bare", "-q", target);
  const save = (name, data) => {
    mkdirSync(dirname(join(source, name)), { recursive: true });
    writeFileSync(join(source, name), data);
  };
  const commit = () => {
    git(source, "add", "-A");
    git(source, "commit", "-qm", "Private source description");
    return git(source, "rev-parse", "HEAD");
  };
  save("package.json", '{"version":"0.2.5"}\n');
  return { dir, source, target, save, commit, scan: () => {} };
}

test("snapshot history is independent, append-only, idempotent and tracks file deletions", (t) => {
  const f = fixture(t);
  f.save(".env", "PRIVATE_VALUE=old\n");
  const old = f.commit();
  git(f.source, "tag", "v0.1.0");
  git(f.source, "rm", "-q", ".env");
  f.save("README.md", "Reviewed public text\n");
  const ref = f.commit();
  const first = syncPublic({ ...f, ref, bootstrap: true });
  assert.equal(git(f.target, "rev-list", "--all", "--count"), "1");
  assert.equal(git(f.target, "tag"), "");
  assert.equal(
    git(f.target, "log", "--format=%ae", first.root),
    publicIdentity.email,
  );
  assert.throws(() => git(f.target, "cat-file", "-e", old));
  assert.throws(() => git(f.target, "cat-file", "-e", ref));
  f.save("src/new.txt", "New public content\n");
  const next = f.commit();
  const second = syncPublic({ ...f, ref: next, root: first.root });
  assert.equal(git(f.target, "rev-parse", "master^"), first.publicCommit);
  assert.equal(git(f.target, "rev-list", "--all", "--count"), "2");
  assert.equal(
    syncPublic({ ...f, ref: next, root: first.root }).changed,
    false,
  );
  git(f.source, "rm", "-q", "src/new.txt");
  syncPublic({ ...f, ref: f.commit(), root: first.root });
  assert.throws(() => git(f.target, "show", "master:src/new.txt"));
  assert.equal(
    git(f.target, "rev-list", "--max-parents=0", "master"),
    first.root,
  );
  assert.equal(second.changed, true);
});

test("unrelated roots, extra tags, scanner failure and foreign authors never change downstream", (t) => {
  const f = fixture(t);
  const ref = f.commit();
  const first = syncPublic({ ...f, ref, bootstrap: true });
  assert.throws(
    () => syncPublic({ ...f, ref, root: "0".repeat(40) }),
    /root differs/,
  );
  git(f.target, "tag", "unexpected", "master");
  assert.throws(
    () => syncPublic({ ...f, ref, root: first.root }),
    /without tags/,
  );
  git(f.target, "tag", "-d", "unexpected");
  assert.throws(
    () =>
      syncPublic({
        ...f,
        ref,
        root: first.root,
        scan: () => {
          throw new Error("Secret scan rejected");
        },
      }),
    /Secret scan rejected/,
  );
  assert.equal(git(f.target, "rev-parse", "master"), first.publicCommit);
  assert.throws(
    () => syncPublic({ ...f, ref, bootstrap: true }),
    /empty remote/,
  );
  const tree = git(f.target, "rev-parse", "master^{tree}");
  const foreign = git(
    f.target,
    "-c",
    "user.name=Someone",
    "-c",
    "user.email=someone@example.com",
    "commit-tree",
    tree,
    "-p",
    first.publicCommit,
    "-m",
    "Independent change",
  );
  git(f.target, "update-ref", "refs/heads/master", foreign);
  assert.throws(
    () => syncPublic({ ...f, ref, root: first.root }),
    /Unexpected downstream author/,
  );
  assert.equal(git(f.target, "rev-parse", "master"), foreign);
});

test("export rejects private file paths, personal metadata, unreviewed binaries and symlinks", (t) => {
  const f = fixture(t);
  for (const [name, value, pattern] of [
    [".env", "TOKEN=value", /Private data path/],
    [
      "docs/private.md",
      "Connect to " + [10, 99, 88, 77].join("."),
      /private network/,
    ],
    [
      "docs/private.md",
      ["C:", "Users", "sample", "recording"].join("\\"),
      /Personal home path/,
    ],
    ["docs/private.md", "someone" + "@" + "company.invalid", /email address/],
    ["docs/image.png", Buffer.from([0, 1, 2]), /Unreviewed binary/],
  ]) {
    f.save(name, value);
    const ref = f.commit();
    assert.throws(
      () => exportSnapshot(f.source, ref, mkdtempSync(join(f.dir, "export-"))),
      pattern,
    );
    git(f.source, "rm", "-q", name);
  }
  const blob = git(f.source, "hash-object", "-w", "package.json");
  git(f.source, "update-index", "--add", "--cacheinfo", `120000,${blob},link`);
  git(f.source, "commit", "-qm", "Synthetic symlink");
  assert.throws(
    () => exportSnapshot(f.source, "HEAD", join(f.dir, "link-export")),
    /regular files/,
  );
});
