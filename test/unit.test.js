import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { expandPath, installLayout, readJson, writeJson, HOME } from "../src/paths.js";
import { parseFrontmatter, generateRouting } from "../src/routing.js";
import { resolveTargets, TARGET_IDS } from "../src/targets.js";

const scratch = mkdtempSync(join(tmpdir(), "lark-skill-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function writeSkill(base, name, description, refs = []) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`,
  );
  for (const ref of refs) {
    const file = join(dir, "references", ref);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, `# ${ref}\n`);
  }
  return dir;
}

describe("paths", () => {
  it("expands ~ against HOME", () => {
    assert.equal(expandPath("~/x", "/base"), join(HOME, "x"));
    assert.equal(expandPath("~"), HOME);
  });

  it("resolves relative paths against the base", () => {
    assert.equal(expandPath("./rel", "/base"), "/base/rel");
  });

  it("lays out install paths under one root", () => {
    const layout = installLayout("/tmp/inst");
    assert.equal(layout.root, "/tmp/inst");
    assert.equal(layout.skillMd, "/tmp/inst/SKILL.md");
    assert.equal(layout.vendorSkills, "/tmp/inst/vendor/larksuite-cli/skills");
    assert.equal(layout.sourceJson, "/tmp/inst/vendor/larksuite-cli/SOURCE.json");
  });

  it("round-trips JSON and can back up the previous file", () => {
    const file = join(scratch, "cfg.json");
    writeJson(file, { a: 1 });
    assert.deepEqual(readJson(file), { a: 1 });

    const backup = writeJson(file, { a: 2 }, { backup: true });
    assert.ok(backup && existsSync(backup), "backup file should exist");
    assert.deepEqual(readJson(file), { a: 2 });
    assert.deepEqual(readJson(backup), { a: 1 });
  });

  it("returns null for a missing or empty file", () => {
    assert.equal(readJson(join(scratch, "nope.json")), null);
    const empty = join(scratch, "empty.json");
    writeFileSync(empty, "   \n");
    assert.equal(readJson(empty), null);
  });
});

describe("frontmatter", () => {
  it("parses name and description", () => {
    const file = join(scratch, "fm.md");
    writeFileSync(file, '---\nname: lark-im\ndescription: "飞书即时通讯：收发消息"\nmetadata:\n  x: 1\n---\n\nbody\n');
    const parsed = parseFrontmatter(file);
    assert.equal(parsed.name, "lark-im");
    assert.equal(parsed.description, "飞书即时通讯：收发消息");
  });

  it("handles block-scalar descriptions and missing frontmatter", () => {
    const file = join(scratch, "fm2.md");
    writeFileSync(file, "---\nname: a\ndescription: |\n  line one\n  line two\n---\n");
    assert.equal(parseFrontmatter(file).description, "line one line two");

    const folded = join(scratch, "fm3.md");
    writeFileSync(folded, "---\nname: b\ndescription: >-\n  folded\n  text\n---\n");
    assert.equal(parseFrontmatter(folded).description, "folded text");

    const plain = join(scratch, "plain.md");
    writeFileSync(plain, "no frontmatter here\n");
    assert.deepEqual(parseFrontmatter(plain), { name: null, description: "" });
  });
});

describe("routing table", () => {
  it("generates a table listing every vendored sub-skill", () => {
    const skillsDir = join(scratch, "routing-skills");
    writeSkill(skillsDir, "lark-im", "messages");
    writeSkill(skillsDir, "lark-mail", "mail", ["a.md", "nested/b.md"]);

    const out = join(scratch, "out", "routing.md");
    const result = generateRouting({
      skillsDir,
      outFile: out,
      root: scratch,
      source: { ref: "v1.0.0", vendorOf: "larksuite/cli" },
    });

    assert.equal(result.count, 2);
    assert.equal(result.refs, 2);

    const text = readFileSync(out, "utf8");
    assert.match(text, /larksuite\/cli` @ `v1\.0\.0`/);
    assert.match(text, /`lark-im`/);
    assert.match(text, /vendor\/larksuite-cli\/skills\/lark-mail\/SKILL\.md/);
    assert.match(text, /references\/nested\/b\.md/);
  });
});

describe("targets", () => {
  it("exposes pi, zcode and the shared agents dir", () => {
    assert.deepEqual(TARGET_IDS, ["pi", "zcode", "agents"]);
  });

  it("resolves explicit target lists", () => {
    assert.deepEqual(resolveTargets("pi").map((t) => t.id), ["pi"]);
    assert.deepEqual(resolveTargets("pi,zcode").map((t) => t.id), ["pi", "zcode"]);
    assert.deepEqual(resolveTargets("all").map((t) => t.id), TARGET_IDS);
  });

  it("falls back to something usable for auto detection", () => {
    assert.ok(resolveTargets("auto").length >= 1);
    assert.ok(resolveTargets("").length >= 1);
  });

  it("never auto-registers the shared ~/.agents directory", () => {
    // It is read by every harness on the machine, so it must stay opt-in.
    for (const spec of ["auto", ""]) {
      const ids = resolveTargets(spec).map((t) => t.id);
      assert.ok(!ids.includes("agents"), `auto must not include agents (spec=${JSON.stringify(spec)})`);
    }
    assert.deepEqual(resolveTargets("agents").map((t) => t.id), ["agents"]);
  });

  it("rejects unknown targets", () => {
    assert.throws(() => resolveTargets("vscode"), /unknown target/);
  });
});

describe("safety invariants", () => {
  it("never places the install dir inside an agent skills directory", () => {
    const layout = installLayout("~/.lark-skill");
    for (const dir of ["/.zcode/skills/", "/.agents/skills/", "/.pi/agent/skills/"]) {
      assert.ok(!layout.root.includes(dir), `install root must not live in ${dir}`);
    }
  });

  it("keeps vendored skills nested under vendor/ so agents skip them", () => {
    const layout = installLayout("/tmp/x");
    assert.ok(layout.vendorSkills.includes("/vendor/"));
  });
});
