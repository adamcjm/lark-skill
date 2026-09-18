import { execFile } from "node:child_process";
import { createWriteStream, existsSync, readdirSync, rmSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { isDir, writeJson } from "./paths.js";
import { dim, spinner, warn } from "./ui.js";

const execFileAsync = promisify(execFile);

export const OFFICIAL_REPO = "larksuite/cli";
export const OFFICIAL_REPO_URL = `https://github.com/${OFFICIAL_REPO}`;

const semverKey = (tag) =>
  tag
    .replace(/^v/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);

function compareTags(a, b) {
  const [x, y] = [semverKey(a), semverKey(b)];
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

/** List official release tags. Prefers git (no rate limits), falls back to the GitHub API. */
export async function listTags() {
  try {
    const { stdout } = await execFileAsync("git", [
      "ls-remote",
      "--tags",
      "--refs",
      `${OFFICIAL_REPO_URL}.git`,
    ]);
    const tags = stdout
      .split("\n")
      .map((line) => line.split("refs/tags/")[1]?.trim())
      .filter((t) => t && /^v\d+\.\d+\.\d+$/.test(t));
    if (tags.length) return tags.sort(compareTags);
  } catch {
    // fall through to the HTTP API
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${OFFICIAL_REPO}/tags?per_page=100`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "lark-skill" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const tags = body.map((t) => t.name).filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
    return tags.sort(compareTags);
  } catch (error) {
    throw new Error(
      `cannot list tags from ${OFFICIAL_REPO_URL}: ${error.message}\n` +
        `   Pass an explicit version instead, e.g. --ref v1.0.96`,
    );
  }
}

/**
 * Pick which tag to vendor.
 * Default is the tag matching the installed lark-cli so commands and docs agree.
 */
export async function resolveRef({ ref, latest = false, cliVersion = null } = {}) {
  if (ref) return { ref, reason: "explicit --ref" };

  const tags = await listTags();
  const newest = tags.at(-1);

  if (latest) return { ref: newest, reason: "--latest" };

  if (cliVersion) {
    const wanted = `v${cliVersion}`;
    if (tags.includes(wanted)) {
      return { ref: wanted, reason: `matches installed lark-cli ${cliVersion}` };
    }
    return {
      ref: newest,
      reason: `no tag ${wanted} for installed lark-cli ${cliVersion}; using newest`,
      mismatchedCli: cliVersion,
    };
  }

  return { ref: newest, reason: "newest (lark-cli not detected)" };
}

async function download(url, file, label) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "lark-skill" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status} for ${url}`);
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  let seen = 0;
  const spin = spinner(`${label} ${total ? `${(total / 1048576).toFixed(1)} MB` : ""}`);
  const source = Readable.fromWeb(res.body);
  source.on("data", (chunk) => {
    seen += chunk.length;
  });
  try {
    await pipeline(source, createWriteStream(file));
  } catch (error) {
    spin.fail();
    throw error;
  }
  spin.succeed(
    `${label} done ${dim(`(${(seen / 1048576).toFixed(1)} MB)`)}`,
  );
  return seen;
}

/**
 * Download the official skills for `ref` into `destSkills`.
 * Uses GitHub's source tarball so git is not required.
 */
export async function downloadSkills({ ref, destSkills, log = () => {} }) {
  const work = await mkdtemp(join(tmpdir(), "lark-skill-"));
  const tarball = join(work, "cli.tar.gz");
  try {
    const url = `https://codeload.github.com/${OFFICIAL_REPO}/tar.gz/refs/tags/${ref}`;
    const bytes = await download(url, tarball, `Downloading ${OFFICIAL_REPO} @ ${ref}`);

    const extractTo = join(work, "extract");
    await mkdir(extractTo, { recursive: true });
    try {
      await execFileAsync("tar", ["-xzf", tarball, "-C", extractTo]);
    } catch (error) {
      throw new Error(
        `tar failed (is tar available?): ${error.stderr || error.message}`,
      );
    }

    const top = readdirSync(extractTo).map((e) => join(extractTo, e)).find(isDir);
    if (!top) throw new Error("unexpected tarball layout: no top-level directory");

    const skillsSrc = join(top, "skills");
    const srcStat = await stat(skillsSrc).catch(() => null);
    if (!srcStat?.isDirectory()) {
      throw new Error(`tarball for ${ref} has no skills/ directory`);
    }

    await rm(destSkills, { recursive: true, force: true });
    // The copy is verbatim: the official files keep their internal relative
    // references (../lark-shared/SKILL.md, references/*.md) intact.
    await cp(skillsSrc, destSkills, { recursive: true });

    const isolated = join(top, "isolated-skills");
    const isolatedStat = await stat(isolated).catch(() => null);

    return { bytes, skillsSrc, isolatedSrc: isolatedStat?.isDirectory() ? isolated : null };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function writeSourceJson({ file, ref, skillsDir, skillCount, fileCount, cliVersion, isolatedCopied }) {
  writeJson(file, {
    agentSkillRepo: OFFICIAL_REPO_URL,
    vendorOf: OFFICIAL_REPO,
    license: "MIT",
    ref,
    fetchedAt: new Date().toISOString(),
    skillCount,
    fileCount,
    installedCliVersion: cliVersion ?? null,
    isolatedSkillsCopied: Boolean(isolatedCopied),
    note: "Verbatim snapshot of the official skills. Do not edit by hand; run `npx lark-skill update`.",
  });
}

/** Count SKILL.md files one level below `dir`. */
export function countSkills(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md")),
  ).length;
}

export async function copyDir(from, to) {
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
}

export { warn, rmSync };
