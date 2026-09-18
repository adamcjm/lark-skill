import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  countSkills,
  downloadSkills,
  resolveRef,
  writeSourceJson,
} from "./fetch.js";
import { defaultInstallDir, ensureDir, installLayout, expandPath, readJson } from "./paths.js";
import { generateRouting } from "./routing.js";
import { resolveTargets, TARGETS } from "./targets.js";
import { bold, bullet, cyan, dim, fail, green, header, note, step, warn, yellow } from "./ui.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "templates");

/** Read the version of the installed lark-cli, if any. */
export function detectCliVersion() {
  try {
    const out = execFileSync("lark-cli", ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /(\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  }
  return n;
}

function writeTemplates(layout) {
  ensureDir(layout.root);
  ensureDir(layout.references);
  copyFileSync(join(TEMPLATES, "SKILL.md"), layout.skillMd);
  const readme = join(TEMPLATES, "README.install.md");
  if (existsSync(readme)) copyFileSync(readme, layout.readme);
}

function printSummary(layout, { cliVersion, ref, reason, skills, files, results }) {
  header("Installed");
  bullet("skills dir", layout.root);
  bullet("official skills", `${skills} sub-skills, ${files} files`);
  bullet("vendored ref", `${ref} ${dim(`(${reason})`)}`);
  bullet("lark-cli", cliVersion ?? `${yellow("not found")} — install with: npm i -g @larksuite/cli`, {
    ok: Boolean(cliVersion),
  });
  console.log();
  header("Registered with");
  for (const r of results) {
    const mark = r.error ? "⚠️" : r.result?.changed ? "✅" : "•";
    const detail = r.error ? r.error.message : r.result?.detail ?? "";
    console.log(`  ${mark} ${r.target.title.padEnd(18)} ${dim(detail)}`);
  }
  const restarts = results.filter((r) => !r.error && r.result?.changed).map((r) => r.target.hint);
  if (restarts.length) {
    console.log();
    note(`  Restart to activate: ${[...new Set(restarts)].join(" · ")}`);
  }
  console.log();
  console.log(`${green("Done.")} ${bold("One skill is exposed; the rest stay vendored and out of your prompt.")}`);
  console.log(dim(`  Try asking: "看一下我明天的日程" or "读我收件箱里最新的邮件"`));
}

export async function install({ dir, ref, latest = false, target = "auto", quiet = false } = {}) {
  const layout = installLayout(dir ?? defaultInstallDir());
  const cliVersion = detectCliVersion();

  if (!quiet) step(`Install directory: ${cyan(layout.root)}`);
  const { ref: chosen, reason, mismatchedCli } = await resolveRef({ ref, latest, cliVersion });
  if (!quiet) step(`Vendoring ${cyan(`larksuite/cli@${chosen}`)} ${dim(`(${reason})`)}`);

  ensureDir(layout.vendor);
  const { bytes, isolatedSrc } = await downloadSkills({ ref: chosen, destSkills: layout.vendorSkills });

  const skills = countSkills(layout.vendorSkills);
  if (skills === 0) throw new Error(`downloaded ref ${chosen} contains no skills`);

  if (isolatedSrc) {
    const { cp } = await import("node:fs/promises");
    await cp(isolatedSrc, join(layout.vendor, "isolated-skills"), { recursive: true });
  }

  const files = countFiles(layout.vendorSkills);
  await writeSourceJson({
    file: layout.sourceJson,
    ref: chosen,
    skillsDir: layout.vendorSkills,
    skillCount: skills,
    fileCount: files,
    cliVersion,
    isolatedCopied: Boolean(isolatedSrc),
  });

  if (!quiet) step("Writing entry SKILL.md and routing table");
  writeTemplates(layout);
  const routing = generateRouting({
    skillsDir: layout.vendorSkills,
    outFile: layout.routing,
    root: layout.root,
    source: readJson(layout.sourceJson),
  });

  const targets = resolveTargets(target);
  const results = [];
  for (const t of targets) {
    try {
      results.push({ target: t, result: t.register({ ...layout, skillMd: layout.skillMd, root: layout.root }) });
    } catch (error) {
      results.push({ target: t, error });
    }
  }

  if (!quiet) {
    printSummary(layout, { cliVersion, ref: chosen, reason, skills, files, results });
    if (mismatchedCli) {
      warn(
        `installed lark-cli is ${mismatchedCli} but no matching tag existed; docs may reference newer commands`,
      );
      warn(`upgrade with: npm i -g @larksuite/cli@latest && npx lark-skill update --latest`);
    }
    if (routing.count !== skills) {
      warn(`routing table lists ${routing.count} skills but ${skills} were vendored`);
    }
  }

  return { layout, skills, files, ref: chosen, cliVersion, routing, results, bytes };
}

export async function doctor({ dir, target = "auto" } = {}) {
  const explicit = Boolean(dir);
  const layout = installLayout(dir ?? defaultInstallDir());
  const cliVersion = detectCliVersion();
  const installed = existsSync(layout.skillMd) && existsSync(layout.vendorSkills);

  header("lark-skill status");
  bullet("install dir", layout.root, { ok: installed });
  if (!installed && !explicit) {
    console.log();
    note("  Not installed yet. Run: npx lark-skill");
    return { installed: false };
  }

  const source = readJson(layout.sourceJson);
  const skills = installed ? countSkills(layout.vendorSkills) : 0;
  bullet("vendored ref", source?.ref ?? "—", { ok: Boolean(source) });
  bullet("sub-skills", String(skills), { ok: skills > 0 });
  bullet("fetched at", source?.fetchedAt ?? "—");
  bullet(
    "lark-cli",
    cliVersion ?? "not found — npm i -g @larksuite/cli",
    { ok: Boolean(cliVersion) },
  );
  if (cliVersion && source?.installedCliVersion && cliVersion !== source.installedCliVersion) {
    warn(
      `lark-cli is ${cliVersion} but vendored docs are from ${source.installedCliVersion}; run: npx lark-skill update`,
    );
  }

  console.log();
  header("Registrations");
  const targets = resolveTargets(target);
  const rows = [];
  for (const t of targets) {
    const status = t.status({ ...layout, skillMd: layout.skillMd, root: layout.root });
    rows.push([t.title, status.registered ? "registered" : "not registered", status.detail ?? ""]);
  }
  for (const [name, state, detail] of rows) {
    const mark = state === "registered" ? green("✅") : yellow("⚠️ ");
    console.log(`  ${mark} ${name.padEnd(18)} ${state.padEnd(16)} ${dim(detail)}`);
  }

  if (cliVersion) {
    console.log();
    try {
      const out = execFileSync("lark-cli", ["doctor"], {
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const body = JSON.parse(out);
      for (const check of body.checks ?? []) {
        const mark = check.status === "pass" ? green("✅") : check.status === "warn" ? yellow("⚠️ ") : "❌";
        console.log(`  ${mark} ${String(check.name).padEnd(18)} ${dim(check.message ?? "")}`);
        if (check.hint) console.log(`     ${dim(check.hint)}`);
      }
    } catch {
      note("  (could not run `lark-cli doctor`)");
    }
  }

  return { installed, skills, cliVersion, source };
}

export async function uninstall({ dir, target = "auto", purge = false } = {}) {
  const layout = installLayout(dir ?? defaultInstallDir());
  const results = [];
  for (const t of Object.values(TARGETS)) {
    try {
      results.push({ target: t, result: t.unregister({ ...layout, skillMd: layout.skillMd, root: layout.root }) });
    } catch (error) {
      results.push({ target: t, error });
    }
  }

  header("Unregistered");
  for (const r of results) {
    const mark = r.error ? "⚠️" : r.result?.changed ? "✅" : "•";
    console.log(`  ${mark} ${r.target.title.padEnd(18)} ${dim(r.error?.message ?? r.result?.detail ?? "")}`);
  }

  if (purge && existsSync(layout.root)) {
    rmSync(layout.root, { recursive: true, force: true });
    console.log();
    step(`Removed ${layout.root}`);
  } else {
    console.log();
    note(`  Files kept at ${layout.root} (re-run with --purge to delete them)`);
  }
  return results;
}

/** Files inside the install dir, for inspection. */
export function listInstalled(dir) {
  const layout = installLayout(dir ?? defaultInstallDir());
  if (!existsSync(layout.root)) return [];
  return readdirSync(layout.root).map((name) => {
    const full = join(layout.root, name);
    const st = statSync(full);
    return { name, dir: st.isDirectory(), size: st.size };
  });
}

export { fail, readFileSync };
