# Tasks

## Phase 1 — 目录映射标准（库 + daemon + 迁移）

- [ ] 1.1 库改造：workspaceWikiDirectory(dir)（<dir>/.agents/skill-wiki）+
       global 解析（SKILL_WIKI_HOME 默认 ~/.agents/skill-wiki）；scope
       寻址改目录路径；origin = "~"|workspace 绝对路径；scopes.ts 退役
       删除；slug 校验移除；相似索引目录随 scope；包测试全面更新
- [ ] 1.2 一次性迁移工具（脚本或 CLI 隐式）：~/.skill-wiki/~ → 新 global；
       slug 存量经 registry 映射入各 workspace 目录；~/.skill-creator/wiki
       侧车同链；冲突保守拒绝；测试覆盖三源 × 冲突
- [ ] 1.3 daemon wiki-service：ws_* → registry 目录解析 →
       <dir>/.agents/skill-wiki；~ → global；wiki-root-migration.ts 删除；
       RPC 测试更新（测试注入 tmp workspace 目录）
- [ ] 1.4 两份 README 同步（目录标准章节替换 root/scope 段）+
       docs/search-design.md 或新 docs 补记

## Phase 2 — cli-kit + skill-creator wiki 子命令

- [ ] 2.1 cli.ts 拆层：命令单元（纯函数 + IO 注入）+ createWikiCli(host)
       （resolveScope/commandPrefix/extraCommands 三插槽）；默认实例 =
       bin 行为逐位一致（现有测试零改动通过）
- [ ] 2.2 --workspace <path|~|./> 默认 ./（kit 默认实现；bin usage 更新）
- [ ] 2.3 skill-creator CLI wiki 子命令：createWikiCli + registry 只读
       解析（label 前缀/ws_id/路径）+ scopes 扩展命令；exit code 透传
- [ ] 2.4 测试：kit 插槽单测、skill-creator wiki 子命令端到端（进程内
       tsx 真跑，沙箱 HOME/registry）

## Phase 3 — GUI Wiki 面板

- [ ] 3.1 wiki.scopes RPC（contracts + rpc-contract + daemon 投影 +
       RPC 测试）
- [ ] 3.2 webui wiki App manifest + 路由（/wiki home + /wiki/:wsId）+
       一级导航
- [ ] 3.3 WikiHome（scope 索引卡 + 空态）与 WikiScopeView（patterns
       列表/过滤/追加/相似警告/展开——现有 WikiView 平移演进）+ wiki
       store 扩展（scopes）
- [ ] 3.4 旧 /workspaces/wiki 路由删除 + WorkspacesHome 入口改指 /wiki
       + store 清理；webui 测试更新 + route-match 回归
- [ ] 3.5 组件测试（scopes 列表/追加闭环/detail 导航）+ webui check

## Phase 4 — 边界补账 + 收口

- [ ] 4.1 排除目录内置名单与 Owner 名单 diff 补齐（内置集 + 测试）
- [ ] 4.2 Windows 实机轮（ssh gaubeehonor）：装包 + 包测试 + CLI 直跑 +
       索引/查重冒烟；结论记录 docs
- [ ] 4.3 门禁全绿（test/typecheck/webui check/build/fmt/pack）+ dev
       走查（wiki 面板桌面+窄屏，探针 + vision 判读）
- [ ] 4.4 codex 复核（remix 闭环）+ 处置 + 归档
