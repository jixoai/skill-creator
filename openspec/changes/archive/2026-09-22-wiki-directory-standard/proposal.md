# Proposal: wiki-directory-standard — 目录映射标准 + cli-kit + Wiki 面板

## Why

Owner 裁决（2026-09-22）：wiki 的归属从「中央根按名字分目录」改为「**目录
自身的属性**」——`.agents/skill-wiki/` 成为像 `.git/` 一样的目录约定：

- `workspace=~` → `~/.agents/skill-wiki/`（global 特例）
- `workspace=./` → `./.agents/skill-wiki/`（无需 registry 的项目级使用）
- registry workspace W → `W/.agents/skill-wiki/`（认知跟 workspace 同居）

结构性收益：slug 名字空间分配问题（codex 复核 P1-1 一族）从根上消失，
scopes.json 登记表退役；`~/.skill-creator/wiki` 衔接层与 symlink 迁移机制
消灭；任何 agent 在任何目录可用 wiki（不依赖 skill-creator）。同时 Owner
拍板：CLI `--workspace` 缺省 `./`（项目级一等公民，通用认知显式 `~`）；
skill-creator GUI 新增第四个一级面板 **Wiki**（与 Workspaces 面板同构：
home=scope 索引，detail=patterns 列表）。

配套（同一裁决批次）：

- skill-wiki SDK 提供原子 cli-kit（命令单元 + createWikiCli 组装器），
  skill-creator `wiki` 子命令为首个消费者；
- Windows 实机验证（ssh gaubeehonor）补跨平台欠账；
- skill-search 内置排除目录名单与 Owner 名单（node_modules/.git/build/
  dist/target/.cargo/.cache/.npm/**pycache**/tmp/logs/.pnpm-store/.bun/
  .rustup/.local）核对补齐。

## What Changes

### A. 目录映射标准（skill-wiki 库 + daemon）

- `workspaceWikiDirectory(dir) = <dir>/.agents/skill-wiki/`；global =
  `SKILL_WIKI_HOME`（默认 `~/.agents/skill-wiki`）。scope 寻址从 slug 改为
  workspace 目录路径；`origin` 足迹 = `"~"` 或 workspace 目录绝对路径。
- scopes.ts（slug 登记表）、wiki-root-migration（旧侧车三态迁移）退役
  删除；一次性迁移工具（一次性脚本或 CLI 隐式）：`~/.skill-wiki/~` →
  global 新址；`~/.skill-wiki/<slug>` 与 `~/.skill-creator/wiki` 存量经
  registry 映射搬入各 workspace 目录；冲突保守拒绝。
- daemon wiki-service：`ws_*` → registry 解析 workspace 目录 →
  `<dir>/.agents/skill-wiki`；`~` → global。RPC 契约（scope=WorkspaceId）
  不变。
- 相似索引目录随 scope 走（`<wiki目录>/search-index/`）。

### B. cli-kit + skill-creator wiki 子命令

- skill-wiki cli.ts 拆两层：命令单元（语义参数 → 结构化结果 + exit 语义，
  IO 注入）+ `createWikiCli(host)` 组装器（插槽：resolveScope /
  commandPrefix / extraCommands）；默认实例 = 现有 bin 行为零变化（既有
  测试守护重构）。
- `--workspace <path|~|./>`（默认 `./`）解析进 kit 默认实现。
- skill-creator CLI 新增 `wiki` 子命令：createWikiCli + registry 只读
  scope 解析（label/ws_id → workspace 目录）+ `scopes` 扩展命令（全局
  视角：scope 清单 × pattern 计数 × label）。

### C. GUI Wiki 面板（第四个一级 App）

- manifest 新 App `wiki`（/wiki home + /wiki/:wsId detail）；`wiki.scopes`
  RPC（global 恒列 + registry workspaces：id/label/patternCount/exists）。
- WikiHome：scope 索引（Global 卡 + workspace wiki 卡，未初始化空态）；
  WikiScopeView：patterns 列表/过滤/追加表单/相似警告/展开正文。
- 现有 `/workspaces/wiki/:wsId` 视图与路由迁移进新 App，WorkspacesHome
  wiki 入口改指 `/wiki/<ws>`，旧路由删除。

### D. 边界补账

- 排除目录内置名单与 Owner 名单 diff 补齐（search-config 内置集）。
- Windows 实机轮（ssh gaubeehonor）：装包、包测试、CLI 直跑、索引/查重
  管线冒烟；结论记录 docs。

## Impact

- packages/skill-wiki：workspace.ts/similarity.ts/cli.ts 改造 + scopes.ts
  删除 + kit 新面 + 两份 README 同步；bin 行为不变。
- src/daemon：wiki-service 解析重写、wiki-root-migration.ts 删除、
  rpc-contract wiki 组扩展 scopes。
- webui：新 App + store 扩展 + 旧 WikiView 迁移 + WorkspacesHome 入口改址。
- 根 cli.ts：wiki 子命令。
- 出界：切片③ LLM 编排、GUI 编辑/删除 pattern 的深交互（v1 面与现有
  WikiView 对齐 + scopes home）、skill-wiki 发版。
