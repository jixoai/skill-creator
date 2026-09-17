# Proposal: search robustness — 内容范围与排除配置 / watcher 实时性 / 平台实证 / 复审遗留

## Why

用户裁决 [2026-09-18]：「只要是具有长期价值，现在该做的就做掉，不要做代码
残留。」针对 skill-search 的四项边界质询 + codex 终审（9.2/10）与 vision 走查
遗留的非阻塞项，逐项核实后三真一假：

1. **Q2 内容范围（真缺口）**：当前只索引 `SKILL.md` 单文件。用户预期为中间
   档——skill 文件夹内的全部 Markdown 进入正文索引；同时需要可注释的排除
   配置（TOML），默认清单覆盖 `node_modules/.git/build/dist/target/.cargo/
   .cache/.npm/__pycache__/tmp/logs/.pnpm-store/.bun/.rustup/.local` 等特殊
   目录；暂无 GUI，但界面要提供「在编辑器中打开配置文件」入口。
2. **Q3 实时性（真缺口）**：当前每次 search 都全量 stat 扫描 + realpath
   canonicalize（每次查询的固定成本）。需要高性能监听：fs.watch 事件驱动，
   无变化时搜索纯内存，有变化时去抖后即时 freshen。
3. **Q4 跨平台（未实证）**：Windows 路径（`ssh gaubeehonor`）从未实测——
   `O_NOFOLLOW`/`st_ino`/原子 rename/recursive watch 的平台差异只有代码层
   预留分支，没有真实证据。
4. **Q1 symlink 去重（已闭合，勿重做）**：入口层目录 symlink 跟进 + 递归层
   只走真实目录 + `realpathSync` canonical 去重（同一物理技能 = 一个文档 ×
   多 installations）+ 文档级 `SKILL.md` symlink 一律拒绝（lstat + fd
   identity）。走查 fixture（`.codex/skills` symlink → `.claude/skills`）
   已实证「1 结果 × 2 安装归属」。

另含 codex 终审遗留小包：Esc/外点 dismiss 可见窗口复验、Repository 安装→
立即可搜的集成测试、检索失败 console 诊断、三处各自声明的 150ms debounce
常量集中、palette 行 scope 字段裸 `string` 收窄。

## What Changes

- **R1 内容范围**：`SKILL.md` 仍是身份/结构源（name/description/keywords/
  triggers/headings/body）；skill 目录内其余 `*.md`（递归真实目录、深度
  ≤4、≤32 文件、dot 目录与排除目录不进、文档级 symlink 拒绝）作为正文补充
  文本进 `body` 字段；`contentHash` 语义升级为「实际被索引文件集字节」。
  信封 `schemaVersion` 2→3（stat 形状改为文件集）+ `PARSER_VERSION` 递增
  （旧缓存一次性全量重建）。
- **R2 排除配置**：`<appDir>/search-config.toml`（server-owned；boot 缺失时
  原子写注释模板）。`excludeDirs`（字符串数组）只在内置清单上**追加**；
  配置摘要 `configDigest` 进信封，配置变更触发全量重建。
- **R3 编辑器入口**：daemon RPC `skills.searchConfig.open`（无输入，打开
  server-owned 配置路径：macOS `open` / Windows `explorer` 系默认 / Linux
  `xdg-open`）；命令面板 Navigate 组「Open search config」+ ProviderView
  过滤栏配置图标。
- **R4 watcher**：service 内建 `SkillSearchWatcher`——freshen 后对去重
  canonical roots reconcile `fs.watch(recursive, persistent:false)`；事件
  置 dirty（去抖合并）；文档量 ≤20k 时去抖后同步 freshen（实时），更大语料
  降级 dirty-lazy（下次 search 时刷新）；watch 失败的 root 回退逐搜索扫描；
  `dispose()` 接入 daemon stop coordinator（不得阻塞进程退出）。
- **R5 Windows 实证**：`ssh gaubeehonor` 真实跑聚焦测试 + CLI smoke；修复
  发现的平台差异（预期风险点：`st_ino` 语义、路径大小写、rename 语义、
  recursive watch）。
- **R6 复审小包**：Esc/外点 dismiss 可见窗口 vision 复验；安装→可搜集成
  测试；检索失败 `console.debug` 诊断；`SEARCH_DEBOUNCE_MS` 集中到 skills
  store 导出；palette 行 scope 字段用 `WorkspaceId`/`ProviderId` 类型。

## Impact

- 代码：`src/daemon/skill-search/`（parser/canonicalize/scanner/index/
  service + 新 config.ts/watcher.ts）、`src/shared/contracts/search.ts`、
  `rpc-contract.ts`、capability 登记、`daemon/index.ts`（teardown）、
  webui（palette/ProviderView/store 常量）、新增 `smol-toml` 依赖。
- 兼容性：索引缓存 v2 一次性废弃重建（无迁移，符合无兼容策略）。
- 风险：Windows 差异修复面在实测前不可枚举（R5 是验证任务不是实现任务）。
