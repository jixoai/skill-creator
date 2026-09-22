# skill-wiki Specification (delta)

## MODIFIED Requirements

### Requirement: skill-wiki 库维护双级 wiki workspace 的目录契约

`skill-wiki` 包 MUST 以纯 TS 库形态提供 WikiWorkspace：wiki 目录含
`index.md`（模式目录，每行一条）、`logs.md`（追加式演化日志）、
`skill-impact.md`（提案→结果记录，程序化追加）与 `patterns/<name>.md`
（单模式页）。**目录映射标准（2026-09-22 Owner 裁决）**：wiki 目录 =
`workspaceWikiDirectory(dir) = <dir>/.agents/skill-wiki/`——workspace 是
目录路径，wiki 是目录自身的属性（`.git/` 式约定）；global 为 `~` 特例
（`SKILL_WIKI_HOME` 覆盖，默认 `~/.agents/skill-wiki`）。registry
workspace 的 wiki 与 workspace 目录同居。scope 形状的 slug 校验与
`scopes.json` 中央登记表 MUST 退役（scope 由路径客观决定，名字空间分配
不存在）。`origin` 足迹 MUST 记 `"~"` 或 workspace 目录绝对路径。全部
从磁盘读入的结构 MUST 经 Zod safeParse 收窄；不兼容投影为该领域空值并
typed 失败于 mutation。pattern 元数据 MUST 预留 `origin`/`promotedFrom`
（泛化溯源：由切片③的 LLM Maintainer 蒸馏写入，非机械升格搬运）。

#### Scenario: 双级作用域解析

- **WHEN** 分别以 `~`（global）与某 workspace 目录解析 wiki
- **THEN** 得到 `~/.agents/skill-wiki/`（或 SKILL_WIKI_HOME 覆盖值）与
  `<dir>/.agents/skill-wiki/`，互不重叠

#### Scenario: digest 形状被拒绝

- **WHEN** workspace 参数为空串、或解析失败的非路径形状
- **THEN** 收到 typed `WIKI_INVALID_SCOPE` 失败（形状校验退役 slug 规则
  后仍拒绝非法 workspace 输入）

#### Scenario: 宿主与 CLI 同根

- **WHEN** skill-creator daemon 写入某 workspace wiki 后，CLI 在同一
  workspace 目录读取
- **THEN** 两者看到同一份 patterns（同一物理目录 `<dir>/.agents/skill-wiki`）

#### Scenario: 项目级使用无需 registry

- **WHEN** 在任意目录以 `--workspace ./`（缺省）执行 CLI
- **THEN** 该目录的 `.agents/skill-wiki/` 被创建/使用，不依赖任何中央
  注册状态

#### Scenario: 畸形 wiki 投影为空

- **WHEN** patterns 目录中存在非法 frontmatter 的 md
- **THEN** 列表读取丢弃该条（不抛错）；对该条的 mutation typed 拒绝

#### Scenario: 存量一次性迁移

- **WHEN** 存在旧布局（`~/.skill-wiki/` 中央根或 `~/.skill-creator/wiki`
  侧车）且新址无数据
- **THEN** 迁移工具把 global 存量搬至新 global 址、slug 存量经 registry
  映射搬入对应 workspace 目录；目标冲突时保守拒绝并列出冲突项

## ADDED Requirements

### Requirement: cli-kit 原子命令单元与宿主组装器

skill-wiki MUST 提供 cli-kit：命令单元（语义参数 → 结构化结果 + exit
语义，IO 全注入的纯函数）与 `createWikiCli(host)` 组装器。host 插槽
MUST 限于 `resolveScope`（宿主上下文 → workspace 目录）、`commandPrefix`、
`extraCommands`。默认实例 MUST 与既有 bin 行为逐位一致（现有测试守护）。
kit MUST 保证口径原子（exit code 2/3/4/5、`--json` 形状、相似警告管线
单源）与单命令操作原子；MUST NOT 提供跨命令事务。`--workspace <path|~|./>`
MUST 由 kit 默认实现解析，缺省 `./`。

#### Scenario: 默认实例行为不变

- **WHEN** 以空 host 调 createWikiCli 并喂既有 CLI 测试的全部 argv
- **THEN** 输出与 exit code 与重构前逐位一致

#### Scenario: 宿主插槽生效

- **WHEN** 宿主注入 resolveScope（如 skill-creator 的 registry 只读解析）
  与 extraCommands（如 scopes）
- **THEN** scope 解析走宿主实现，扩展命令出现在 usage，通用命令面零新增

### Requirement: skill-creator CLI 提供 wiki 子命令

skill-creator CLI MUST 提供 `wiki` 子命令：经 createWikiCli 组装，
`--workspace` 支持 registry label/ws_id 解析（进程内只读 registry）与
路径直传；MUST 含 `scopes` 扩展命令（scope 清单 × pattern 计数 ×
workspace label 的全局视角）。子命令 MUST 进程内执行（无 daemon 依赖，
与 search 子命令同模式）。

#### Scenario: workspace 感知解析

- **WHEN** `skill-creator wiki list --workspace <label前缀|ws_id|路径>`
- **THEN** 解析为对应 workspace 目录的 wiki；解析失败为用法错误 exit 2

#### Scenario: scopes 全局视角

- **WHEN** `skill-creator wiki scopes`
- **THEN** 输出 global 与各 registry workspace 的 pattern 计数与 label
  （`--json` 结构化）
