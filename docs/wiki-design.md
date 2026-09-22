# wiki-design — 目录映射标准

<!--
文件意图（2026-09-22）：固化 wiki 目录映射标准（Owner 裁决）、一次性迁移
说明与历史沿革。正交意图：[1] 标准陈述（寻址/特例/足迹）；[2] 存量迁移工具
用法；[3] 裁决背景与退役机制记录。事实源：openspec/changes/wiki-directory-standard。
-->

## 1. 标准陈述（Owner 裁决 2026-09-22）

wiki 的归属从「中央根按名字分目录」改为「**目录自身的属性**」——
`.agents/skill-wiki/` 是像 `.git/` 一样的目录约定：

| 寻址输入                  | wiki 目录                                                  |
| ------------------------- | ---------------------------------------------------------- |
| `~`（global 特例）        | `SKILL_WIKI_HOME` env > `~/.agents/skill-wiki/`            |
| `./`（CLI 缺省）          | `<cwd>/.agents/skill-wiki/`                                |
| 任意目录 `<dir>`          | `<dir>/.agents/skill-wiki/`                                |
| registry workspace `ws_*` | registry 解析 workspace 目录 → `<dir>/.agents/skill-wiki/` |

要点：

- **无中央根、无 slug 登记表**：scope 由路径客观决定，名字空间分配不存在。
  由此 codex 复核 P1-1 一族问题（同 label 消歧、forget 后存活者顶替裸名、
  登记表损坏）从根上消失——wiki 数据随 workspace 目录走，forget 不影响数据，
  同目录 re-import 直达同一份 patterns。
- **项目级使用无需 registry**：任何 agent 在任何目录可用 wiki（`--workspace ./`
  缺省），不依赖 skill-creator。
- **宿主与 CLI 同根**：daemon 经 registry 写 `<dir>/.agents/skill-wiki`，CLI 以
  `--workspace <dir>` 读回——同一物理目录。
- **origin 足迹约定**：global 写入记 `"~"`，workspace 写入记 workspace 目录
  绝对路径（显示足迹 + 可机器解析）。
- **相似索引随 wiki 目录走**：`<wiki目录>/search-index/`（派生物，缺失重建）。
- RPC 契约不变：`wiki.*` 的 `scope` 参数仍是 `WorkspaceId`（`~` 或 `ws_*`），
  daemon 内部把 `ws_*` 解析为 workspace 目录。

库 API 面（`packages/skill-wiki`）：

- 新增：`workspaceWikiDirectory(dir)`、`globalWikiDirectory()`、
  `resolveWikiDirectory(workspace)`（`"~"`/路径 → wiki 目录；空串/纯空白/含
  NUL → typed `WIKI_INVALID_SCOPE`）。
- 退役删除：`scopes.ts` 整个模块（`openScopeSlugRegistry`/`scopeSlugBase`）、
  `parseWikiScope`、`wikiScopeDirectory`、`SLUG_SCOPE_REGEX`、`WikiScope`、
  `defaultWikiRoot`；错误码 `WIKI_SCOPE_REGISTRY`/`WIKI_SCOPE_CONFLICT` 删除。
- 查重索引面改名：`openWikiSearchIndex(wikiDirectory, …)`、
  `wikiSearchIndexDirectory`/`wikiCorpusRegistryFile`、
  `registerWikiCorpusEntries`/`unregisterWikiCorpusEntries`。
- CLI：`--scope ~|slug` → `--workspace <path|~|./>`（缺省 `./`，用法错误与
  exit code 口径不变）。

## 2. 存量迁移（一次性）

旧布局两处存量，由 `scripts/migrate-wiki-roots.sh.ts` 迁入新址：

1. **中央根** `~/.skill-wiki/`（slug 布局）：
   - `~/`（global）→ 新 global 址（`SKILL_WIKI_HOME` > `~/.agents/skill-wiki`）；
   - `<slug>/` → 读**旧登记表** `~/.skill-wiki/scopes.json`（id→slug）+ registry
     `workspaces.json`（id→path）→ `<path>/.agents/skill-wiki/`；无登记表映射的
     孤儿 slug 目录只列出，不自动搬；
   - `ws_*` digest 目录（slug 化之前的存量）直连 registry id。
2. **旧侧车** `~/.skill-creator/wiki/`（切片②布局，scope = `ws_*` 或 `~`）：
   global 部分搬 global 新址；ws id 部分经 registry 搬 workspace 目录；若整个
   侧车是统一根时代的兼容 symlink，报告 no-op（数据已在中央根）。

行为语义：

- **默认 dry-run**（只输出计划）；`--apply` 才写入。同卷 rename 优先，跨卷
  （EXDEV）回退「复制到目标旁临时目录 + rename 落位 + 删源」。
- **保守拒绝**：目标 wiki 目录已存在且非空 → conflict 列出（不覆盖任何一边，
  不删除任何一边）；中央根与侧车同目标时中央根先迁、侧车让位。
- **幂等**：源缺失或目标已有数据 = no-op 报告；`scopes.json` 与
  `search-index/` 留在原地（登记表是退役档案、索引是派生物，均可人工清理）。

```bash
bun scripts/migrate-wiki-roots.sh.ts            # dry-run：查看计划
bun scripts/migrate-wiki-roots.sh.ts --apply    # 执行迁移
# 可选覆盖（测试/特殊环境）：--central-root / --sidecar-root / --global-target
```

测试：`test/wiki-roots-migration.test.ts`（三源 × 冲突 × dry-run/apply ×
孤儿 × 幂等 × symlink no-op）。

## 3. 沿革

- 2026-09-21：skill-wiki 孵化（切片②侧车 `~/.skill-creator/wiki/<scope>`；
  jixoai-search-core 3.1/3.2 统一根 `~/.skill-wiki/` + slug 寻址 +
  `scopes.json` 持久登记表 + 侧车 symlink 衔接迁移）。
- 2026-09-22（Owner 裁决，openspec change `wiki-directory-standard`）：
  目录映射标准生效——中央根/登记表/symlink 衔接机制全部退役；daemon
  `wiki-root-migration.ts` 删除（存量改由一次性脚本处理）；CLI `--workspace`
  缺省 `./`。后续 Phase 2（cli-kit + skill-creator `wiki` 子命令）与
  Phase 3（GUI Wiki 面板）见 change tasks。
