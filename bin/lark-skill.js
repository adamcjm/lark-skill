#!/usr/bin/env node
import { detectCliVersion, doctor, install, uninstall } from "../src/commands.js";
import { defaultInstallDir } from "../src/paths.js";
import { bold, cyan, dim, fail, green, header, note, yellow } from "../src/ui.js";

const HELP = `
${bold("lark-skill")} — expose Feishu/Lark to your agent as ONE skill, not 27.

${bold("USAGE")}
  npx @adamcjm/lark-skill ${dim("[command] [options]")}

${bold("COMMANDS")}
  ${cyan("install")}     ${dim("(default)")} vendor the official Lark skills and register with your agent
  ${cyan("update")}      re-download the official skills (keeps the entry skill in place)
  ${cyan("doctor")}      show install state, registrations and lark-cli health
  ${cyan("uninstall")}   unregister from your agent ${dim("(add --purge to delete files too)")}
  ${cyan("help")}        this text

${bold("OPTIONS")}
  ${cyan("--dir <path>")}      install location        ${dim(`(default ${defaultInstallDir()})`)}
  ${cyan("--target <list>")}   ${dim("pi,zcode,agents,auto,all")}   ${dim("(default auto-detect)")}
  ${cyan("--ref <tag>")}       pin an official version  ${dim("(e.g. v1.0.96)")}
  ${cyan("--latest")}          use the newest tag instead of matching lark-cli
  ${cyan("--purge")}           with uninstall: also delete the install directory
  ${cyan("--quiet")}           less output
  ${cyan("--no-color")}        disable ANSI colors
  ${cyan("-h, --help")}        this text
  ${cyan("-v, --version")}     print version

${bold("EXAMPLES")}
  ${dim("$")} npx @adamcjm/lark-skill                 ${dim("# just install it")}
  ${dim("$")} npx @adamcjm/lark-skill --target pi     ${dim("# only wire up pi")}
  ${dim("$")} npx @adamcjm/lark-skill --latest        ${dim("# newest official skills")}
  ${dim("$")} npx @adamcjm/lark-skill doctor          ${dim("# is everything wired up?")}

${bold("PREREQUISITE")}
  npm i -g @larksuite/cli && lark-cli config init && lark-cli auth login --recommend
`;

function parseArgs(argv) {
  const opts = { command: null, dir: null, target: "auto", ref: null, latest: false, purge: false, quiet: false, help: false, version: false };
  const commands = new Set(["install", "update", "doctor", "uninstall", "help"]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (commands.has(arg) && !opts.command) {
      opts.command = arg;
      continue;
    }
    const takeValue = (name) => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--dir": opts.dir = takeValue("--dir"); break;
      case "--target": opts.target = takeValue("--target"); break;
      case "--ref": opts.ref = takeValue("--ref"); break;
      case "--latest": opts.latest = true; break;
      case "--purge": opts.purge = true; break;
      case "--quiet": case "-q": opts.quiet = true; break;
      case "--no-color": process.env.NO_COLOR = "1"; break;
      case "--help": case "-h": opts.help = true; break;
      case "--version": case "-v": opts.version = true; break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  if (opts.version) {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
    );
    console.log(pkg.version);
    return;
  }

  const command = opts.help ? "help" : opts.command ?? "install";

  try {
    switch (command) {
      case "help":
        console.log(HELP);
        return;
      case "install":
        await install(opts);
        return;
      case "update": {
        await install(opts);
        return;
      }
      case "doctor": {
        const r = await doctor(opts);
        if (!r.installed) process.exitCode = 1;
        return;
      }
      case "uninstall":
        await uninstall(opts);
        return;
      default:
        fail(`unknown command: ${command}`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error();
    fail(error.message);
    if (process.env.LARK_SKILL_DEBUG) console.error(error.stack);
    process.exitCode = 1;
  }
}

main();
