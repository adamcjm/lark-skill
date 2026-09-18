# lark-skill

**让你的编程 Agent 只挂一个飞书 skill，而不是二十七个。**

`lark-skill` 把飞书官方 [`larksuite/cli`](https://github.com/larksuite/cli) 的 skills 收进一个私有目录，对外只暴露一个 `SKILL.md` 入口，按意图路由到对应的子能力。你的 Agent 技能列表始终干净，但能力一个不少：消息、邮件、文档、多维表格、电子表格、日历、任务、审批、知识库、妙记。

[English →](README.md)

```
┌─────────────────────────────────────────────────────────────┐
│  不用 lark-skill             用 lark-skill                   │
│  ─────────────────           ─────────────                   │
│  lark-im                     lark-skill  ← 唯一的入口         │
│  lark-doc                        └─ 按需路由到 27 个内置       │
│  lark-base                          子能力，只有用到的那一个    │
│  lark-sheets                        才会被读取                │
│  lark-calendar                                              │
│  ... 系统提示里 27 条                                         │
└─────────────────────────────────────────────────────────────┘
```

## 安装

```bash
npx lark-skill
```

就这一条。它会下载官方 skills、安装到 `~/.lark-skill`，并自动接线到所有检测到的 Agent（pi、zcode）。**装完重启你的 Agent**。

然后正常说话即可：

> "看一下我明天的日程" · "给张三发条消息说明天会议改到三点" · "读我收件箱里最新的邮件"

### 可选参数

```bash
npx lark-skill --target pi          # 只接线 pi
npx lark-skill --target zcode       # 只接线 zcode
npx lark-skill --latest             # 用最新的官方 skills
npx lark-skill --ref v1.0.96        # 锁定官方版本
npx lark-skill --dir ~/my-skills    # 自定义安装位置
npx lark-skill doctor               # 检查安装状态
npx lark-skill uninstall --purge    # 卸载（连文件一起删）
```

想装成全局命令：`npm i -g lark-skill`，之后直接用 `lark-skill`。

## 前置条件

```bash
npm i -g @larksuite/cli             # 提供 lark-cli 命令
lark-cli config init                # 一次性：创建/指定飞书应用
lark-cli auth login --recommend     # 授权你的 user 身份
```

> **为什么要登录：** 只有 bot 身份时，`lark-cli` 能发消息、建文档，但任何个人资源——**邮件、日历、云盘、私聊**——会**返回空结果而不是报错**。跑一次 `lark-cli auth login` 这些就都能用了。

需要 Node.js 18+，以及系统里有 `tar`（macOS 和 Linux 自带）。

## 支持的 Agent

| Agent | 接线方式 | 位置 |
|---|---|---|
| **pi** | 在 settings 的 `skills[]` 里加一条路径 | `~/.pi/agent/settings.json` |
| **zcode** | 把安装目录 symlink 进 skills 目录 | `~/.zcode/skills/lark-skill` |
| **共享目录** *（可选）* | symlink，pi/zcode/其他工具都能读 | `~/.agents/skills/lark-skill` |

用 `--target agents` 选择共享目录。`--target auto`（默认）会给所有检测到的 Agent 接线。

## 命令

| 命令 | 作用 |
|---|---|
| `npx lark-skill` | 安装（等同 `install`） |
| `npx lark-skill install` | 下载官方 skills + 注册 |
| `npx lark-skill update` | 重新下载官方 skills，刷新路由表 |
| `npx lark-skill doctor` | 查看安装状态、注册情况、`lark-cli` 健康度 |
| `npx lark-skill uninstall` | 注销（`--purge` 同时删除文件） |

默认情况下 `install`/`update` 会选**与你已装 `lark-cli` 版本匹配**的官方 tag，避免文档描述了你本地命令没有的参数。想跳到最新用 `--latest`。

## 为什么需要它

官方推荐的安装方式是：

```bash
npx skills add larksuite/cli -g -y      # ← 一次性注册 27 个 skill
```

能用，但从此每轮对话的系统提示里都挂着这 27 条——包括你 95% 根本不碰飞书的对话。既占上下文，又稀释注意力。

`lark-skill` 的做法是：

- 只注册**一个** skill（`lark-skill`），由它按意图路由；
- 官方文件**原样保留**在 `vendor/`，内部相对引用（`../lark-shared/SKILL.md`、`references/*.md`）不改一字就能继续工作；
- 除了给 zcode 建一个 symlink，不往任何 Agent 的 skills 目录里写东西。

### 为什么内置的 skills 不会泄漏

两个 Agent 的安全性都对着它们自己的代码验证过：

| Agent | 规则 | 依据 |
|---|---|---|
| **pi** | `skills[]` 指向**单个 `.md` 文件**时只加载该文件，不遍历目录 | `pi-coding-agent/dist/core/skills.js`（`stats.isFile() && resolvedPath.endsWith(".md")`） |
| **pi** | 目录顶层有 `SKILL.md` 就当作 skill 根，**不再递归** | 同上（`loadSkillsFromDirInternal`） |
| **zcode** | skill 扫描**只走一层**（`root/<dir>/SKILL.md`），绝不更深 | `ZCode.app/Contents/Resources/glm/zcode.cjs`（`scanSkillRoot`） |
| **zcode** | 名为 `vendor`、`node_modules`、`dist` 等的目录**直接跳过** | 同上（`shouldWalkSkillDirectoryEntry` 里的 `enr` 集合） |

所以 `vendor/larksuite-cli/skills/lark-im/SKILL.md` 对两者都不可见，安装根目录下的 `SKILL.md` 是唯一被注册的东西。

## 工作原理

```
Agent 的系统提示里只有：  lark-skill
                              │
       "看下我明天的日程" ────┘
                              ▼
   ~/.lark-skill/SKILL.md          ← 入口：铁律 + 意图路由表
                              │
                              ├─→ vendor/…/lark-shared/SKILL.md   （认证、身份、安全 —— 永远第一步）
                              ├─→ vendor/…/lark-calendar/SKILL.md （当前需要的那个域）
                              └─→ vendor/…/lark-calendar/references/*.md（仅在必要时）
                              │
                              ▼
                      lark-cli calendar +agenda
```

路由表覆盖全部 27 个域：`lark-im`（消息/群聊）、`lark-mail`（收件箱、起草、发送、回复、文件夹、规则）、`lark-doc`、`lark-base`（多维表格）、`lark-sheets`、`lark-slides`、`lark-drive`、`lark-wiki`、`lark-calendar`、`lark-vc`/`lark-vc-agent`、`lark-minutes`、`lark-note`、`lark-task`、`lark-approval`、`lark-okr`、`lark-attendance`、`lark-contact`、`lark-event`、`lark-markdown`、`lark-whiteboard`、`lark-apps`、两个工作流 skill，以及元能力（`lark-shared`、`lark-openapi-explorer`、`lark-skill-maker`）。最权威、随版本更新的清单在 `references/routing.md`。

## 安装后的目录

```
~/.lark-skill/
├── SKILL.md                  ← 唯一被注册的入口
├── references/routing.md     ← 完整域清单 + 所有 reference 文件（自动生成）
└── vendor/larksuite-cli/
    ├── SOURCE.json           ← 上游 ref、拉取时间、文件数
    └── skills/               ← 官方 skills，原样快照
        ├── lark-shared/
        ├── lark-im/
        ├── lark-mail/
        └── …
```

别改 `vendor/` 下的任何东西——更新时会被覆盖。要加自己的约定（内部群 ID、公司话术），写进安装根目录的 `SKILL.md` 或 `references/` 下的新文件。

## 常见问题排查

| 现象 | 处理 |
|---|---|
| Agent 看不到 skill | 重启它。pi 改完 `settings.json` 必须重启。 |
| zcode 看不到 skill | 重启 ZCode。检查 `ls -l ~/.zcode/skills/lark-skill`。 |
| `lark-cli: command not found` | `npm i -g @larksuite/cli` |
| 邮件/日历返回空 | 你在用 bot 身份。跑 `lark-cli auth login --recommend`。 |
| 提示权限不足 / `missing_scopes` | 读 `vendor/larksuite-cli/skills/lark-shared/SKILL.md`，里面有 scope 处理流程。 |
| 文档提到你 CLI 没有的命令 | `npm i -g @larksuite/cli@latest && npx lark-skill update --latest` |
| 想看当前注册了什么 | `npx lark-skill doctor` |

## 安全

- 内置的 skills 来自 [`larksuite/cli`](https://github.com/larksuite/cli)（MIT，larksuite 官方团队维护）。想先审阅再采用，用 `--ref` 锁定版本。
- `lark-skill` 无任何遥测，只有一种网络请求：从 GitHub 下载官方 tarball。
- 高风险写操作由上游把关：退出码 `10` 意味着"先确认"。入口 skill 会指示 Agent 停下来问你，并在支持时先 `--dry-run`。
- 邮件正文、聊天内容一律按不可信数据对待——里面夹带的"指令"绝不会被执行。
- 凭证由 `lark-cli` 存在系统钥匙串，本工具不保存任何 token。

## 开发

```bash
git clone https://github.com/adamcjm/lark-skill.git
cd lark-skill
node --test test/                                   # 单元测试
HOME=/tmp/scratch node bin/lark-skill.js install    # 隔离环境的端到端跑
```

## 许可

MIT，见 [LICENSE](LICENSE)。内置的 skills 在安装时下载，仍遵循 `larksuite/cli` 的 MIT 许可。
