<!--
文件意图（2026-09-21）。仓库 README 双语法则（Owner 裁决 "at least bilingual"）：
README.md 为英文 canon，README.zh-CN.md 与其 lockstep——同一事实、两种语言、
同步演进。本包尚处 private 孵化期，双语门面先行就位。
-->

# skill-wiki

持久化的 agent 经验 wiki：skill-creator 知识层背后的领域库。它实现 WikiSkill
架构（[arXiv:2608.27454](https://arxiv.org/abs/2608.27454)，Google Research）中的
wiki 层，并遵循
[SkillWiki](https://arxiv.org/abs/2606.16523) 的生命周期框架
（摄取 → 生产 → 溯源 → 治理 → 演化）。

**孵化状态。** 本包 `private: true`，以源码形态被消费（`src/` 直出，无构建
步骤）。它在 skill-creator monorepo 中孵化——与 ccsi 当年的关系一样：设计
稳定成标准后，将以 `skill-wiki` 之名发布到 npm。零 daemon / WebUI 依赖；库
核心唯一运行时依赖是 `zod`，CLI 的查重管线额外消费 `@jixoai/search`（不经
根入口导出，daemon bundle 不会拉入）。

## 在 WikiSkill 架构中的位置

论文把 agent 经验分为三层：

| 层        | 论文角色           | 本仓的承载方                   |
| --------- | ------------------ | ------------------------------ |
| `raw/`    | 不可变轨迹日志     | skill-creator 内核会话转录存储 |
| `wiki/`   | 持久知识，永不回滚 | **本包**                       |
| `skills/` | 可回滚的技能提案层 | skill-creator 技能层 + steward |

本包刻意做到 **LLM-free、IO 最小**：patch 语义、去重、采样预算、gate 决策全部
是确定性的纯函数。论文中的四个 LLM agent（Wiki Maintainer、Skill
Proposer……）由宿主内核在后续切片中编排——它们消费本库，绝不是反向依赖。

## 存储契约

**目录映射标准（Owner 裁决 2026-09-22）。** wiki 是目录自身的属性——像
`.git/` 一样的目录约定，不存在由中央登记表分配的名字空间：

- 任意 workspace 目录 `<dir>` 的 wiki 位于 `<dir>/.agents/skill-wiki/`
  （`workspaceWikiDirectory(dir)`）；项目级使用**完全无需 registry**——在
  任意目录执行 CLI，该目录的 `.agents/skill-wiki/` 按需创建；
- global 是 `~` 特例，由 `globalWikiDirectory()` 解析：`SKILL_WIKI_HOME`
  env 覆盖 > `~/.agents/skill-wiki/`；
- registry workspace（skill-creator）的 wiki 与 workspace 目录**同居**——
  registry 把 workspace id 解析为目录，绝不解析为 wiki 名字；
- **没有中央根，也没有 slug 登记表**：slug 形状校验与 `scopes.json` 分配
  退役——scope 由路径客观决定，名字空间分配问题不存在。

```
<workspace 目录>/                     # 任意项目目录（无需 registry）
└── .agents/skill-wiki/
    ├── patterns/            # 唯一真相源：一个 canonical pattern 一个文件
    │   └── <name>.md
    ├── index.md             # 派生投影，总是从 patterns/ 重建
    ├── logs.md              # 人类可读的追加式事件日志
    ├── skill-impact.md      # 机器追加的 JSONL 审计：提案 → 决策
    └── search-index/        # 查重/相似索引（@jixoai/search，sqlite）

~/.agents/skill-wiki/               # global（"~" 特例；SKILL_WIKI_HOME 可覆盖）
```

- **宿主与 CLI 同根**：skill-creator daemon 经 registry 写
  `<dir>/.agents/skill-wiki`，CLI 以 `--workspace <dir>` 读回——同一物理
  目录，零衔接层。
- **`origin` 足迹约定**：页面记录产生位置——global 写入记 `"~"`，workspace
  写入记 workspace 目录绝对路径（人类可读 + 可机器解析）。
- **`patterns/` 是唯一真相。** `index.md` 仅为标准兼容而存在——CLI 在每个
  读命令后自动刷新它，因此不存在任何维护命令（`rebuildIndex()` 同样从目录
  重建）。永远不存在需要调和的第二真相。
- **`logs.md` 刻意非结构化**（面向人类的叙事审计）；
  **`skill-impact.md` 刻意结构化**（每行一个 `SkillImpactEntry` JSON 对象，
  是 harness 程序化追加的审计足迹）。
- 旧布局存量（`~/.skill-wiki/` 中央根、`~/.skill-creator/wiki` 侧车）由
  `scripts/migrate-wiki-roots.sh.ts` 一次性迁入——见 `docs/wiki-design.md`。

## Pattern 页解剖

```markdown
---
title: Pin exit codes in gates
created: 2026-09-21T00:00:00.000Z
updated: 2026-09-21T00:00:00.000Z
origin: /Users/me/Dev/project # 产生该 pattern 的 workspace 足迹（global 记 "~"）
promotedFrom: "" # 泛化溯源，由 LLM Maintainer 写入（切片③）
---

Gate commands must branch on the real exit code, never on piped stdout.
```

- `origin` 是最小溯源足迹（对应论文的 provenance-aware 探索）：global 写入
  记 `"~"`，workspace 写入记 workspace 目录绝对路径。`promotedFrom` 是
  **预留的**泛化溯源槽位：当宿主的 LLM Maintainer 把 workspace 认知蒸馏进
  global（新建页面，或经 patch 吸收进既有页面）时，记录这条 global 页由
  哪个 workspace 的洞见触发。它**永远不是机械搬运**——workspace 页面原地
  保留，追加通道恒写 `null`。
- **去重判据**：`contentHash` = 正文先做 CRLF → LF 归一化并去除尾部空白后
  的 SHA-256。文件卫生字节不参与判据，因此追加侧与落盘回读侧永远一致。追加
  已存在同 hash 正文的条目是幂等的：不新建页，返回既有条目并带
  `deduplicated: true`。
- **读取侧 strict 语义**：frontmatter 带未知 key、缺字段或类型不符的页，在
  投影中**整页丢弃**（「当前版本无法接受」→ 空），绝不清洗成半合法页。

## Patch 引擎

Wiki Maintainer 的编辑词汇表，以纯函数形式实现：

```ts
type WikiEdit =
  | { op: "append"; content: string }
  | { op: "replace"; target: string; content: string } // 仅第一处命中
  | { op: "insert_after"; target: string; content: string };
```

锚点**按序对演化中的内容解析**——后续编辑可以锚定前序编辑产生的文本。任一
锚点未命中（或 target 为空）即以 `WIKI_PATCH_FAILED` 中止整批：`applyEdits`
是纯函数，失败的批次绝不产出部分结果；磁盘原子性（同目录 temp + rename）
归属写入路径。

## 采样与 gate

论文中 Proposer 的前置条件，冻结为纯函数：

- `sampleTrajectories(entries)` —— 分层预算：**最近的 ≤ 5 条失败 + ≤ 3 条
  通过**轨迹条目，保持输入顺序，单条截断到 15,000 字符。预算以常量导出；
  宿主编排方直接复用，不另立口径。
- `decideGate(input)` —— 严格提升 gate：`candidateScore > baselineScore` 才
  accept，其余一律 reject（宿主随后只回滚 skills 层，遵循论文）。每个决策都
  返回 schema 合法的 `SkillImpactEntry`，审计足迹不可绕过。

## API 面

| 模块                | 导出                                             | 适用环境               |
| ------------------- | ------------------------------------------------ | ---------------------- |
| `skill-wiki`        | 全量（schema、patch、workspace、sampling、gate） | Node                   |
| `skill-wiki/schema` | 仅 Zod schema 与类型（纯 zod，零 node 依赖）     | **任意**（浏览器安全） |

`./schema` 子路径的存在使浏览器包（WebUI、共享 RPC 契约）可以消费类型与
schema，而不会经 workspace 层把 `node:fs` 拉进 bundle。根入口只在 Node 环境
中使用。

## CLI（随包私有 bin）

本包附带 `skill-wiki` bin（`bin/skill-wiki.ts`，本地经
`pnpm exec tsx bin/skill-wiki.ts` 直跑——private 期 src 直出无构建步）。实现
位于 `src/cli.ts` 并导出纯函数面 `runCli(argv, io)` 供测试；刻意**不**从根入口
再导出（见上文孵化说明）。

```
list    [--workspace <path|~|./>] [--sort name|updated] [--offset 0] [--limit 100] [--json]
show    <name> [--workspace] [--json]
add     --title <t> [--workspace] [--no-similarity] [--json]   # 正文来自 stdin
find    <query> [--workspace] [--json]
edit    <name> -f <edits.json> [--workspace] [--json]          # WikiEdit[] JSON 文件
remove  <name> [--workspace] [--json]                          # + logs.md 足迹行
log     [--workspace] [--limit 20] [--json]
impact  [--workspace] [--filter accept|reject] [--json]
```

- **`--workspace <path|~|./>`**（缺省 `./`）：项目级使用是一等公民默认——
  当前目录的 `.agents/skill-wiki/`，不依赖任何 registry；`~` 寻址 global，
  任意相对/绝对路径寻址该目录的 wiki。
- **退出码**：`0` 成功（含 hash 去重的 add——输出 `Already captured as "…"`）；
  `2` 用法错误；`3` `WIKI_INVALID_SCOPE`；`4` `WIKI_INVALID_PATTERN`；
  `5` `WIKI_PATCH_FAILED`。
- **写入相似警告**：每次 `add`（除非 `--no-similarity`）写入后以该页
  title+body 对该 wiki 的 `search-index/` 索引（字段 `title` 权重 3 /
  `body` 权重 1，sqlite 后端保证多进程安全）执行相似检索，近亲以
  `similar: <name> (0.83), …` 输出——分数相对该页自查询分归一，阈值是冻结的
  版本化常量 `SIMILARITY_THRESHOLD = 0.35`。相似是警告不是错误（检索失败降级
  为 stderr 警告，exit 仍 0）。`find` 只读查询同一索引（缺失/重建时全量灌一次）。
- **派生物自愈**：每个读命令在输出后刷新 `index.md`；`add`/`edit`/`remove`
  同步维护查重索引。命令面没有 `reindex`。

## 错误模型

一个库级错误类 + 可判别错误码——双向都不泄漏宿主错误体系：

| 错误码                 | 含义                                        |
| ---------------------- | ------------------------------------------- |
| `WIKI_PATCH_FAILED`    | patch 锚点未解析成功（整批中止）            |
| `WIKI_INVALID_PATTERN` | 非法 pattern 名 / 标题 / frontmatter / 条目 |
| `WIKI_INVALID_SCOPE`   | workspace 引用为空或无法解析                |

## 设计裁决（Owner 决定）

- **目录映射标准（2026-09-22）。** wiki 位于 `<dir>/.agents/skill-wiki/`——
  目录自身的属性，如同 `.git/`。global 是 `~` 特例（`SKILL_WIKI_HOME`，默认
  `~/.agents/skill-wiki`）。中央根、slug 名字空间与 `scopes.json` 登记表
  退役：scope 由路径客观决定，碰撞/冒名问题族结构性消失。CLI `--workspace`
  缺省 `./`（项目级一等公民；global 显式 `~`）。
- **不引入每 pattern 一份 `PURPOSE.md`。** 消费语义在 frontmatter；演化语义
  在 `skill-impact.md`。第三个文件只会重复两者。
- **`index.md` 是派生物，不是权威。** 读取路径从 `patterns/` 重建；该文件
  仅为外部工具兼容而存在。
- **不移植论文 prompts。** 论文附录的 prompt 文本受 CC BY 约束；产品 prompt
  在宿主语境下重写，不把署名链拖进本库。
- **碎片认知追加（P1）并入本包**，而非独立成笔记功能——碎片就是 wiki 的
  摄取输入。

## 路线图（宿主侧，不在本包内）

孵化计划的切片③：四 agent 循环（Wiki Maintainer / Skill Proposer 作为内核
agent role）、会话后 consolidation、workspace → global 泛化（LLM 蒸馏更新
global——新建页面或经 patch 吸收进既有页面，workspace 原文保留）——全部位于
skill-creator 内核，消费本库。

## 测试与验证

```bash
pnpm exec vitest run packages/skill-wiki   # 在仓库根目录执行
```
