#!/usr/bin/env node
// Keeps the files copied from Brainstorm-UI byte-identical to upstream.
//
//   node scripts/vendor.mjs fetch   download each file at the pinned commit,
//                                   write it, and record its sha256
//   node scripts/vendor.mjs check   exit 1 naming any file that is missing or
//                                   whose sha256 differs from the manifest
//   node scripts/vendor.mjs diff    unified diff of each file against the
//                                   upstream `staging` branch (exit 0)
//
// To update: move "commit" in vendor/brainstorm-ui.json, then run fetch.
// A file can carry a "commit" of its own, for one that was not yet upstream at
// the manifest's commit; fetch and diff then read it at that one.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = join(ROOT, "vendor", "brainstorm-ui.json");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The commit a file is pinned at: its own, or the manifest's.
const pinOf = (manifest, file) => file.commit ?? manifest.commit;

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

// The file's exact bytes at `ref`, through the GitHub contents API.
function fetchUpstream(repo, upstream, ref) {
  const out = execFileSync(
    "gh",
    ["api", `repos/${repo}/contents/${upstream}?ref=${ref}`],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const body = JSON.parse(out.toString("utf8"));
  if (body.type !== "file" || body.encoding !== "base64") {
    throw new Error(`${upstream} at ${ref}: no inline content (type ${body.type})`);
  }
  return Buffer.from(body.content, "base64");
}

function fetchAll() {
  const manifest = readManifest();
  for (const file of manifest.files) {
    const bytes = fetchUpstream(manifest.repo, file.upstream, pinOf(manifest, file));
    const target = join(ROOT, file.local);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    file.sha256 = sha256(bytes);
    console.log(`fetched ${file.local} ${file.sha256.slice(0, 12)}`);
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${manifest.files.length} files at ${manifest.commit.slice(0, 7)}`);
}

function checkAll() {
  const manifest = readManifest();
  const bad = [];
  for (const file of manifest.files) {
    const target = join(ROOT, file.local);
    if (!existsSync(target)) {
      bad.push(`${file.local}: missing`);
    } else if (sha256(readFileSync(target)) !== file.sha256) {
      bad.push(`${file.local}: differs from the pinned copy`);
    }
  }
  if (bad.length > 0) {
    console.error("Vendored files out of step with vendor/brainstorm-ui.json:");
    for (const line of bad) console.error(`  ${line}`);
    console.error("Never edit a vendored file. Run `npm run vendor:fetch` to restore.");
    process.exit(1);
  }
  console.log(`vendor:check ok, ${manifest.files.length} files match`);
}

function diffAll() {
  const manifest = readManifest();
  const scratch = mkdtempSync(join(tmpdir(), "vendor-diff-"));
  let changed = 0;
  try {
    for (const file of manifest.files) {
      const upstream = fetchUpstream(manifest.repo, file.upstream, "staging");
      const upstreamPath = join(scratch, "upstream");
      writeFileSync(upstreamPath, upstream);
      const result = spawnSync(
        "diff",
        [
          "-u",
          "--label",
          `${file.local} (pinned ${pinOf(manifest, file).slice(0, 7)})`,
          "--label",
          `${file.upstream} (staging)`,
          join(ROOT, file.local),
          upstreamPath,
        ],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );
      if (result.status === 0) continue;
      if (result.status !== 1) throw new Error(`diff failed on ${file.local}: ${result.stderr}`);
      changed += 1;
      process.stdout.write(result.stdout);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(
    changed === 0
      ? `no changes on staging across ${manifest.files.length} files`
      : `${changed} of ${manifest.files.length} files differ on staging`,
  );
}

const commands = { fetch: fetchAll, check: checkAll, diff: diffAll };
const run = commands[process.argv[2]];
if (!run) {
  console.error("usage: node scripts/vendor.mjs fetch | check | diff");
  process.exit(2);
}
run();
