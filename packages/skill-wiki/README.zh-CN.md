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

每个 **scope** 一个 wiki，存放在统一根下（绝不进入用户的技能资产）。根解析
顺序：`SKILL_WIKI_HOME` env 覆盖 > `~/.skill-wiki/`（`defaultWikiRoot()`）——
宿主 daemon 与 CLI 同根；skill-creator 宿主以一次性迁移衔接旧路径（mv
`~/.skill-creator/wiki` → `~/.skill-wiki` 后原位建 symlink）：

```
<root>/                      # ~/.skill-wiki/（SKILL_WIKI_HOME 可覆盖）
├── ~/                       # 全局 scope
├── <slug>/                  # 按 workspace 的 scope（例：skill-creator/）
│   ├── patterns/            # 唯一真相源：一个 canonical pattern 一个文件
│   │   └── <name>.md
│   ├── index.md             # 派生投影，总是从 patterns/ 重建
│   ├── logs.md              # 人类可读的追加式事件日志
│   └── skill-impact.md      # 机器追加的 JSONL 审计：提案 → 决策
└── search-index/<scope>/    # 查重/相似索引（@jixoai/search，sqlite）
```

- **scope 双级**：全局 `"~"`（脱离任何 workspace 的泛化知识）与按 workspace
  的 npm-scope 式 slug `^[a-z0-9](-?[a-z0-9])*$`（例：`skill-creator`、
  `my-app`；形状以 `SLUG_SCOPE_REGEX` 导出）。`ws_<24-hex>` digest 形状
  **不再被接受**（private 窗口期内的破坏性变更）；skill-creator 宿主把
  registry 的 workspace id 映射为 label 派生的 slug（首个注册者保留裸名，
  后出现的同 label 冲突方附 `-<4-hex>` digest 后缀）。
- **`patterns/` 是唯一真相。** `index.md` 仅为标准兼容而存在——CLI 在每个
  读命令后自动刷新它，因此不存在任何维护命令（`rebuildIndex()` 同样从目录
  重建）。永远不存在需要调和的第二真相。
- **`logs.md` 刻意非结构化**（面向人类的叙事审计）；
  **`skill-impact.md` 刻意结构化**（每行一个 `SkillImpactEntry` JSON 对象，
  是 harness 程序化追加的审计足迹）。

## Pattern 页解剖

```markdown
---
title: Pin exit codes in gates
created: 2026-09-21T00:00:00.000Z
updated: 2026-09-21T00:00:00.000Z
origin: ws_0123…def # 产生该 pattern 的 scope 足迹
promotedFrom: "" # 泛化溯源，由 LLM Maintainer 写入（切片③）
---

Gate commands must branch on the real exit code, never on piped stdout.
```

- `origin` 是最小溯源足迹（对应论文的 provenance-aware 探索）。
  `promotedFrom` 是**预留的**泛化溯源槽位：当宿主的 LLM Maintainer 把
  workspace 认知蒸馏进 global（新建页面，或经 patch 吸收进既有页面）时，
  记录这条 global 页由哪个 workspace 的洞见触发。它**永远不是机械搬运**——
  workspace 页面原地保留，追加通道恒写 `null`。
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
list    [--scope ~|slug] [--sort name|updated] [--offset 0] [--limit 100] [--json]
show    <name> [--scope] [--json]
add     --title <t> [--scope] [--no-similarity] [--json]   # 正文来自 stdin
find    <query> [--scope] [--json]
edit    <name> -f <edits.json> [--scope] [--json]          # WikiEdit[] JSON 文件
remove  <name> [--scope] [--json]                          # + logs.md 足迹行
log     [--scope] [--limit 20] [--json]
impact  [--scope] [--filter accept|reject] [--json]
```

- **退出码**：`0` 成功（含 hash 去重的 add——输出 `Already captured as "…"`）；
  `2` 用法错误；`3` `WIKI_INVALID_SCOPE`；`4` `WIKI_INVALID_PATTERN`；
  `5` `WIKI_PATCH_FAILED`。
- **写入相似警告**：每次 `add`（除非 `--no-similarity`）写入后以该页
  title+body 对 scope 的 `search-index/<scope>/` 索引（字段 `title` 权重 3 /
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
| `WIKI_INVALID_SCOPE`   | scope id 既非 `~` 也非 npm-scope 式 slug    |

## 设计裁决（2026-09-21，Owner 决定）

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
