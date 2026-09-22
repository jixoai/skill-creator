# Tasks

## Phase 1 — 目录映射标准（库 + daemon + 迁移）

- [x] 1.1 库改造：workspaceWikiDirectory(dir)（<dir>/.agents/skill-wiki）+
      global 解析（SKILL_WIKI_HOME 默认 ~~/.agents/skill-wiki）；scope
      寻址改目录路径；origin = "~~"|workspace 绝对路径；scopes.ts 退役
      删除；slug 校验移除；相似索引目录随 scope；包测试全面更新
- [x] 1.2 一次性迁移工具（脚本或 CLI 隐式）：~~/.skill-wiki/~~ → 新 global；
      slug 存量经 registry 映射入各 workspace 目录；~/.skill-creator/wiki
      侧车同链；冲突保守拒绝；测试覆盖三源 × 冲突
- [x] 1.3 daemon wiki-service：ws_* → registry 目录解析 →
      <dir>/.agents/skill-wiki；~ → global；wiki-root-migration.ts 删除；
      RPC 测试更新（测试注入 tmp workspace 目录）
- [x] 1.4 两份 README 同步（目录标准章节替换 root/scope 段）+
      docs/search-design.md 或新 docs 补记

## Phase 2 — cli-kit + skill-creator wiki 子命令

- [x] 2.1 cli.ts 拆层：命令单元（纯函数 + IO 注入）+ createWikiCli(host)
      （resolveScope/commandPrefix/extraCommands 三插槽）；默认实例 =
      bin 行为逐位一致（现有测试零改动通过）
- [x] 2.2 --workspace <path|~|./> 默认 ./（kit 默认实现；bin usage 更新）
- [x] 2.3 skill-creator CLI wiki 子命令：createWikiCli + registry 只读
      解析（label 前缀/ws_id/路径）+ scopes 扩展命令；exit code 透传
- [x] 2.4 测试：kit 插槽单测、skill-creator wiki 子命令端到端（进程内
      tsx 真跑，沙箱 HOME/registry）

## Phase 3 — GUI Wiki 面板

- [x] 3.1 wiki.scopes RPC（contracts + rpc-contract + daemon 投影 +
      RPC 测试）
- [x] 3.2 webui wiki App manifest + 路由（/wiki home + /wiki/:wsId）+
      一级导航
- [x] 3.3 WikiHome（scope 索引卡 + 空态）与 WikiScopeView（patterns
      列表/过滤/追加/相似警告/展开——现有 WikiView 平移演进）+ wiki
      store 扩展（scopes）
- [x] 3.4 旧 /workspaces/wiki 路由删除 + WorkspacesHome 入口改指 /wiki + store 清理；webui 测试更新 + route-match 回归
- [x] 3.5 组件测试（scopes 列表/追加闭环/detail 导航）+ webui check

## Phase 4 — 边界补账 + 收口

- [x] 4.1 排除目录内置名单与 Owner 名单 diff 补齐（内置集 + 测试）
      → 核对结论（2026-09-22）：零缺口。Owner 15 项 = 内置
      BUILTIN_EXCLUDED_DIRS 7 项（node_modules/build/dist/target/
      **pycache**/tmp/logs，content-files.ts）+ dot 目录无条件全跳规则
      8 项（.git/.cargo/.cache/.npm/.pnpm-store/.bun/.rustup/.local）；
      search-config.toml 模板另将 7 个 dot 名显式写出（可注释、只能追加
      排除、内置不可移除）。无需代码变更。
- [x] 4.2 Windows 实机轮（ssh gaubeehonor）：装包 + 包测试 + CLI 直跑 +
      索引/查重冒烟；结论记录 docs
      → 收据（2026-09-22，docs/search-design.md §17）：包 165/165（tantivy
      win32 binding ✓）；skill-search index+service 22/22；rpc-search+
      robustness+benchmark 15/15；CLI 冒烟（绝对路径/~ /find/exit 3）全绿。
      修复三类：SkillSearchIndex.close() 面 + dispose 关引擎；多实例测试进程
      边界显式 close；chmod 注入换跨平台 meta.json 目录注入。全量套件其余
      63 失败为非辖区既有 Windows 债（清单见 §17）。
- [x] 4.3 门禁全绿（test/typecheck/webui check/build/fmt/pack）+ dev
      走查（wiki 面板桌面+窄屏，探针 + vision 判读）
      → 收据（2026-09-22）：全量 1344 绿（3 文件满载超时 flake 隔离复跑
      28/28）；typecheck/webui check(0/0)/build/fmt/diff/pack 全绿 + 依赖
      卫生（workspace:* 仅 devDeps）。dev 走查（Vite+daemon+内置浏览器）：
      第四面板导航/scope 索引/详情/数据流实测；vision 判读桌面 pass×2，
      窄屏阻塞项（语义标题宽度 0）当场修复回归（h1 87px 实测）。走查另
      抓到 WikiScopeView 误用 $app/state page.params（ws_* 静默兜底
      Global）——已改 shell useParams + 回归钉。
- [ ] 4.4 codex 复核（remix 闭环）+ 处置 + 归档
      → r1（2026-09-22）：7.8/10 NEEDS-WORK——P1×1（scopes 对部分初始化
      目录惰性 mkdir）+ P2×5；全部处置：SDK countWikiPatterns 只读计数
      （daemon/CLI 共用）、registry 读取 ENOENT-only + EACCES hard error、
      Windows 反斜杠路径形状直传、dispose 转 async 完成屏障、超限错误
      文本逐位恢复、本文件 4.2/4.3 收口。待 r2 复验。
