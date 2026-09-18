import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const HOME = homedir();

/** Expand a leading `~` and resolve relative paths against `base`. */
export function expandPath(input, base = process.cwd()) {
  if (!input) return input;
  let p = String(input);
  if (p === "~") p = HOME;
  else if (p.startsWith("~/")) p = join(HOME, p.slice(2));
  return isAbsolute(p) ? resolve(p) : resolve(base, p);
}

/**
 * Default install location. Kept out of any agent's skills directory on
 * purpose: agents only ever see the single SKILL.md we point them at.
 */
export function defaultInstallDir() {
  return join(HOME, ".lark-skill");
}

export function installLayout(dir) {
  const root = expandPath(dir);
  const vendor = join(root, "vendor", "larksuite-cli");
  return {
    root,
    skillMd: join(root, "SKILL.md"),
    readme: join(root, "README.md"),
    references: join(root, "references"),
    routing: join(root, "references", "routing.md"),
    vendor,
    vendorSkills: join(vendor, "skills"),
    sourceJson: join(vendor, "SOURCE.json"),
  };
}

export function readJson(file) {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`not valid JSON: ${file} (${error.message})`);
  }
}

/** Write JSON, optionally backing up the previous file. Returns backup path or null. */
export function writeJson(file, data, { backup = false } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  let backupPath = null;
  if (backup && existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
    backupPath = `${file}.bak-${stamp}`;
    renameSync(file, backupPath);
  }
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return backupPath;
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
