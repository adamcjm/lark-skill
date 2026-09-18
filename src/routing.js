import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { ensureDir } from "./paths.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

function unquote(value) {
  let v = String(value).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v.replace(/\s+/g, " ").trim();
}

/**
 * Minimal scan of the top-level YAML keys in a frontmatter block.
 * Handles plain scalars, quoted scalars and block scalars (`|`, `>`), which is
 * all the official skills use. Nested keys are ignored on purpose.
 */
function parseTopLevelYaml(text) {
  const lines = text.split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1];
    const rest = m[2];
    if (/^[|>][-+]?$/.test(rest.trim())) {
      const folded = rest.trim().startsWith(">");
      const buf = [];
      while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) {
        i += 1;
        buf.push(lines[i].trim());
      }
      out[key] = buf.join(folded ? " " : "\n");
    } else {
      out[key] = rest;
    }
  }
  return out;
}

/** Parse the subset of YAML frontmatter we care about from a SKILL.md. */
export function parseFrontmatter(file) {
  const text = readFileSync(file, "utf8");
  const block = FRONTMATTER.exec(text);
  if (!block) return { name: null, description: "" };
  const yaml = parseTopLevelYaml(block[1]);
  return {
    name: yaml.name ? unquote(yaml.name) : null,
    description: yaml.description ? unquote(yaml.description) : "",
  };
}

function collect(dir) {
  const refDir = join(dir, "references");
  if (!existsSync(refDir)) return [];
  const out = [];
  const walk = (base, prefix = "") => {
    for (const entry of readdirSync(base, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(base, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk(refDir);
  return out;
}

/** Build references/routing.md from the vendored official skills. */
export function generateRouting({ skillsDir, outFile, root, source }) {
  const groups = readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, "SKILL.md")))
    .map((e) => {
      const dir = join(skillsDir, e.name);
      const { name, description } = parseFrontmatter(join(dir, "SKILL.md"));
      return { id: e.name, name: name ?? e.name, description, refs: collect(dir) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const prefix = "vendor/larksuite-cli/skills/";
  const lines = [];
  lines.push("# 飞书子能力完整路由表\n");
  lines.push(
    `> 来源：\`${source?.vendorOf ?? "larksuite/cli"}\` @ \`${source?.ref ?? "unknown"}\`，` +
      `共 ${groups.length} 个子能力。`,
  );
  lines.push("> 由 `npx lark-skill update` 自动生成，**请勿手改**。");
  lines.push("> **不要整体通读**：先按速查表定位 1~2 个候选，再读对应的 `SKILL.md`。\n");

  lines.push("## 速查表\n");
  lines.push("| 子能力 | 完整触发词 / 适用场景 | references |");
  lines.push("|---|---|---|");
  for (const g of groups) {
    const desc = (g.description || "（无 description）").replace(/\|/g, "\\|");
    lines.push(`| \`${g.id}\` | ${desc} | ${g.refs.length} |`);
  }

  lines.push("\n## 读取路径\n");
  lines.push(`全部为相对 \`${relative(process.cwd(), root) || "."}/\` 的路径：\n`);
  for (const g of groups) {
    lines.push(`- \`${g.id}\` → \`${prefix}${g.id}/SKILL.md\``);
  }

  lines.push("\n## 各子能力的 references 清单\n");
  lines.push("子能力需要深入时会指向自己 `references/` 下的文件，清单如下：\n");
  for (const g of groups) {
    lines.push(`### ${g.id} (${g.refs.length} refs)\n`);
    if (g.refs.length) {
      for (const r of g.refs) lines.push(`- \`${prefix}${g.id}/references/${r}\``);
    } else {
      lines.push("- （无 references，单文件 skill）");
    }
    lines.push("");
  }

  ensureDir(join(outFile, ".."));
  writeFileSync(outFile, `${lines.join("\n")}\n`, "utf8");
  return { count: groups.length, refs: groups.reduce((n, g) => n + g.refs.length, 0) };
}
