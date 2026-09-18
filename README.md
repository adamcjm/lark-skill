# lark-skill

**Give your coding agent Feishu/Lark as _one_ skill, not twenty-seven.**

`lark-skill` vendors the official [`larksuite/cli`](https://github.com/larksuite/cli) skills into a private directory and exposes a single `SKILL.md` entry point that routes to them on demand. Your agent's skill list stays clean; you still get everything: messages, mail, docs, Base, sheets, calendar, tasks, approvals, wiki, minutes.

[中文说明 →](README.zh.md)

```
┌─────────────────────────────────────────────────────────────┐
│  Without lark-skill          With lark-skill                │
│  ───────────────────         ────────────────               │
│  lark-im                     lark-skill  ← 1 entry          │
│  lark-doc                        └─ routes to 27 vendored   │
│  lark-base                          skills, only the one    │
│  lark-sheets                        you need gets loaded    │
│  lark-calendar                                              │
│  ... 27 entries in your prompt                              │
└─────────────────────────────────────────────────────────────┘
```

## Install

```bash
npx lark-skill
```

That's it. It downloads the official skills, installs them to `~/.lark-skill`, and wires up every agent it finds (pi, zcode). **Restart your agent** afterwards.

Then just talk normally:

> "看一下我明天的日程" · "给张三发条消息说明天会议改到三点" · "读我收件箱里最新的邮件"

### Options

```bash
npx lark-skill --target pi          # only wire up pi
npx lark-skill --target zcode       # only wire up zcode
npx lark-skill --latest             # newest official skills
npx lark-skill --ref v1.0.96        # pin an official version
npx lark-skill --dir ~/my-skills    # custom install location
npx lark-skill doctor               # check everything
npx lark-skill uninstall --purge    # remove (files too)
```

Prefer a global command? `npm i -g lark-skill` then use `lark-skill` directly.

## Requirements

```bash
npm i -g @larksuite/cli             # provides the lark-cli binary
lark-cli config init                # one-time: create/point at a Feishu app
lark-cli auth login --recommend     # authorize your user identity
```

> **Why the login matters:** with only the bot identity, `lark-cli` can post messages and create docs, but anything personal — **mail, calendar, drive, private chats** — returns *empty results instead of an error*. Run `lark-cli auth login` once and those work.

Node.js 18+ is required. `tar` must be available (it is on macOS and Linux).

## Supported agents

| Agent | How it's wired | Where |
|---|---|---|
| **pi** | adds one path to `skills[]` in settings | `~/.pi/agent/settings.json` |
| **zcode** | symlinks the install dir into the skills folder | `~/.zcode/skills/lark-skill` |
| **shared** *(opt-in)* | symlink, readable by pi/zcode/others | `~/.agents/skills/lark-skill` |

Use `--target agents` to opt into the shared directory. `--target auto` (the default) registers every agent it detects.

## Commands

| Command | What it does |
|---|---|
| `npx lark-skill` | Install (same as `install`) |
| `npx lark-skill install` | Vendor official skills + register |
| `npx lark-skill update` | Re-download official skills, refresh the routing table |
| `npx lark-skill doctor` | Install state, registrations, `lark-cli` health |
| `npx lark-skill uninstall` | Unregister (`--purge` also deletes files) |

By default `install`/`update` pick the official tag that **matches your installed `lark-cli`**, so the docs never describe commands your binary doesn't have. Use `--latest` to jump ahead.

## Why this exists

The official instructions say:

```bash
npx skills add larksuite/cli -g -y      # ← registers all 27 skills globally
```

That works, but every one of those 27 entries then sits in your system prompt for every conversation — including the 95% where you never touch Feishu. It costs context and dilutes attention.

`lark-skill` instead:

- registers **one** skill (`lark-skill`) that routes by intent,
- keeps the official files **verbatim** in `vendor/`, so their internal relative links (`../lark-shared/SKILL.md`, `references/*.md`) keep working without any rewriting,
- never writes to any agent's skills directory except a single symlink for zcode.

### Why the vendored skills don't leak

Both agents are provably safe here, verified against their own code:

| Agent | Rule | Source |
|---|---|---|
| **pi** | A `skills[]` entry pointing at a **single `.md` file** loads only that file — no directory walk. | `pi-coding-agent/dist/core/skills.js` (`stats.isFile() && resolvedPath.endsWith(".md")`) |
| **pi** | A directory whose top level has `SKILL.md` is treated as a skill root and **not recursed into**. | same file (`loadSkillsFromDirInternal`) |
| **zcode** | Skill scanning descends **exactly one level** (`root/<dir>/SKILL.md`), never deeper. | `ZCode.app/Contents/Resources/glm/zcode.cjs` (`scanSkillRoot`) |
| **zcode** | Directories named `vendor`, `node_modules`, `dist`, … are **skipped outright**. | same file (`enr` set in `shouldWalkSkillDirectoryEntry`) |

So `vendor/larksuite-cli/skills/lark-im/SKILL.md` is invisible to both, while `SKILL.md` at the install root is the only thing registered.

## How it works

```
your agent's prompt sees:  lark-skill
                               │
        "看下我明天的日程" ─────┘
                               ▼
   ~/.lark-skill/SKILL.md          ← entry: rules + intent routing table
                               │
                               ├─→ vendor/…/lark-shared/SKILL.md   (auth, identity, safety — always first)
                               ├─→ vendor/…/lark-calendar/SKILL.md (the one domain needed)
                               └─→ vendor/…/lark-calendar/references/*.md (only if required)
                               │
                               ▼
                       lark-cli calendar +agenda
```

The routing table covers all 27 domains: `lark-im` (messages/groups), `lark-mail` (inbox, compose, send, reply, folders, rules), `lark-doc`, `lark-base` (Bitable), `lark-sheets`, `lark-slides`, `lark-drive`, `lark-wiki`, `lark-calendar`, `lark-vc`/`lark-vc-agent`, `lark-minutes`, `lark-note`, `lark-task`, `lark-approval`, `lark-okr`, `lark-attendance`, `lark-contact`, `lark-event`, `lark-markdown`, `lark-whiteboard`, `lark-apps`, two workflow skills, and the meta skills (`lark-shared`, `lark-openapi-explorer`, `lark-skill-maker`). The authoritative, always-updated list lives in `references/routing.md`.

## Layout after install

```
~/.lark-skill/
├── SKILL.md                  ← the only registered entry point
├── references/routing.md     ← full domain list + every reference file (generated)
└── vendor/larksuite-cli/
    ├── SOURCE.json           ← upstream ref, fetch time, counts
    └── skills/               ← official skills, verbatim snapshot
        ├── lark-shared/
        ├── lark-im/
        ├── lark-mail/
        └── …
```

Don't edit anything under `vendor/` — it's overwritten on update. To add your own conventions (internal group IDs, house style), put them in the install root's `SKILL.md` or a new file under `references/`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agent doesn't see the skill | Restart it. pi must be restarted after `settings.json` changes. |
| zcode doesn't see the skill | Restart ZCode. Check `ls -l ~/.zcode/skills/lark-skill`. |
| `lark-cli: command not found` | `npm i -g @larksuite/cli` |
| Mail/calendar returns empty | You're on bot identity. Run `lark-cli auth login --recommend`. |
| "permission denied" / `missing_scopes` | Read `vendor/larksuite-cli/skills/lark-shared/SKILL.md` — it covers scope handling. |
| Docs mention a command your CLI lacks | `npm i -g @larksuite/cli@latest && npx lark-skill update --latest` |
| Want to see what's registered | `npx lark-skill doctor` |

## Security

- The vendored skills come from [`larksuite/cli`](https://github.com/larksuite/cli) (MIT, maintained by the larksuite team). Pin a version with `--ref` if you want to review before adopting changes.
- `lark-skill` contains no telemetry and makes exactly one kind of network request: downloading the official tarball from GitHub.
- High-risk writes are gated upstream: exit code `10` means "confirm first". The entry skill instructs the agent to stop and ask you, and to `--dry-run` when available.
- Mail bodies and chat content are treated as untrusted data — instructions embedded in them are never executed.
- Credentials live in your OS keychain via `lark-cli`. This tool stores no tokens.

## Development

```bash
git clone https://github.com/adamcjm/lark-skill.git
cd lark-skill
node --test test/                       # unit tests
HOME=/tmp/scratch node bin/lark-skill.js install   # isolated end-to-end run
```

## License

MIT — see [LICENSE](LICENSE). The vendored skills are downloaded at install time and remain under their own MIT license from `larksuite/cli`.
