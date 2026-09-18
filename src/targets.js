import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { HOME, isDir, readJson, writeJson } from "./paths.js";

const PI_SETTINGS = join(HOME, ".pi", "agent", "settings.json");
const ZCODE_HOME = join(HOME, ".zcode");
const ZCODE_SKILLS = join(ZCODE_HOME, "skills");
const AGENTS_SKILLS = join(HOME, ".agents", "skills");

const SKILL_NAME = "lark-skill";

function isLinkedTo(link, target) {
  try {
    if (!lstatSync(link).isSymbolicLink()) return false;
    return readlinkSync(link).replace(/\/+$/, "") === target.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

function placeSymlink(link, target) {
  try {
    const st = lstatSync(link);
    if (st.isSymbolicLink() && readlinkSync(link) === target) return "unchanged";
    rmSync(link, { recursive: true, force: true });
  } catch {
    // nothing there
  }
  mkdirSync(join(link, ".."), { recursive: true });
  symlinkSync(target, link, "dir");
  return "created";
}

/** pi reads extra skill paths from ~/.pi/agent/settings.json `skills[]`. */
const pi = {
  id: "pi",
  title: "pi",
  detect: () => existsSync(join(HOME, ".pi", "agent")),
  hint: "restart pi to pick up the change",

  status({ skillMd }) {
    const settings = readJson(PI_SETTINGS);
    const list = Array.isArray(settings?.skills) ? settings.skills : [];
    return { registered: list.includes(skillMd), detail: PI_SETTINGS, entries: list };
  },

  register({ skillMd }) {
    const settings = readJson(PI_SETTINGS);
    if (settings === null && !existsSync(PI_SETTINGS)) {
      mkdirSync(join(PI_SETTINGS, ".."), { recursive: true });
    }
    const current = settings ?? {};
    const list = Array.isArray(current.skills) ? [...current.skills] : [];
    if (list.includes(skillMd)) {
      return { changed: false, detail: PI_SETTINGS };
    }
    list.unshift(skillMd);
    current.skills = list;
    const backup = writeJson(PI_SETTINGS, current, { backup: existsSync(PI_SETTINGS) });
    return { changed: true, detail: PI_SETTINGS, backup };
  },

  unregister({ skillMd }) {
    const settings = readJson(PI_SETTINGS);
    if (!settings || !Array.isArray(settings.skills)) return { changed: false };
    const next = settings.skills.filter((s) => s !== skillMd);
    if (next.length === settings.skills.length) return { changed: false };
    if (next.length) settings.skills = next;
    else delete settings.skills;
    const backup = writeJson(PI_SETTINGS, settings, { backup: true });
    return { changed: true, detail: PI_SETTINGS, backup };
  },
};

/**
 * zcode discovers skills at <home>/.zcode/skills/<name>/SKILL.md (one level,
 * no recursion) and skips directories named `vendor`, so linking the install
 * directory exposes exactly one skill.
 */
const zcode = {
  id: "zcode",
  title: "zcode",
  detect: () => existsSync(ZCODE_HOME),
  hint: "restart ZCode to pick up the change",

  status({ root }) {
    const link = join(ZCODE_SKILLS, SKILL_NAME);
    return { registered: isLinkedTo(link, root), detail: link, link, target: root };
  },

  register({ root }) {
    const link = join(ZCODE_SKILLS, SKILL_NAME);
    const action = placeSymlink(link, root);
    return { changed: action !== "unchanged", detail: link, action };
  },

  unregister() {
    const link = join(ZCODE_SKILLS, SKILL_NAME);
    if (!existsSync(link) && !lstatSync(link, { throwIfNoEntry: false })) return { changed: false };
    try {
      lstatSync(link);
    } catch {
      return { changed: false };
    }
    rmSync(link, { recursive: true, force: true });
    return { changed: true, detail: link };
  },
};

/** Shared ~/.agents/skills directory, read by pi, zcode and other harnesses. */
const agents = {
  id: "agents",
  title: "shared ~/.agents",
  detect: () => isDir(AGENTS_SKILLS),
  hint: "restart your agent to pick up the change",

  status({ root }) {
    const link = join(AGENTS_SKILLS, SKILL_NAME);
    return { registered: isLinkedTo(link, root), detail: link };
  },

  register({ root }) {
    const link = join(AGENTS_SKILLS, SKILL_NAME);
    const action = placeSymlink(link, root);
    return { changed: action !== "unchanged", detail: link, action };
  },

  unregister() {
    const link = join(AGENTS_SKILLS, SKILL_NAME);
    try {
      lstatSync(link);
    } catch {
      return { changed: false };
    }
    rmSync(link, { recursive: true, force: true });
    return { changed: true, detail: link };
  },
};

export const TARGETS = { pi, zcode, agents };
export const TARGET_IDS = Object.keys(TARGETS);

/** Resolve a --target value ("auto", "pi,zcode", "all", ...) into target objects. */
export function resolveTargets(spec = "auto") {
  if (!spec || spec === "auto") {
    // pi and zcode are wired up automatically. The shared ~/.agents directory
    // is opt-in only: it is read by every harness on the machine, so writing
    // there should never be a side effect of a bare `npx lark-skill`.
    const auto = [TARGETS.pi, TARGETS.zcode].filter((t) => t.detect());
    return auto.length ? auto : [TARGETS.pi, TARGETS.zcode];
  }
  if (spec === "all") return TARGET_IDS.map((id) => TARGETS[id]);
  const ids = String(spec)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unknown = ids.filter((id) => !TARGETS[id]);
  if (unknown.length) {
    throw new Error(`unknown target(s): ${unknown.join(", ")} (available: ${TARGET_IDS.join(", ")})`);
  }
  return ids.map((id) => TARGETS[id]);
}
