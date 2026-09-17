# Proposal: skill search GUI — ProviderView 检索 / 命令面板全局搜索 / composer `$` 菜单

## Why

用户决策 [2026-09-17]：「同意下一阶段规划，开始持续推进，记得要用 vision
子代理做真实走查。」后端接入（skill-search-integration：`skills.search`
RPC + MCP + 模式面）已交付；本 change 是两段规划第二段——GUI 三处消费方
升级，让「任何需要搜索 skills 的地方」都吃到 BM25 + 中文分词 + typo 容忍：

1. ProviderView 的 `q` 过滤目前是前端 lowercase includes（无排序、无中文
   分词、无 typo 容忍）。
2. 跨 Workspace 找技能没有任何入口（composer `$` 是唯一全局面，但它是
   引用选择器，不是发现入口）。
3. composer `$` 菜单全量拉取所有 workspace × provider 的技能再前端子序列
   匹配——916 skills 走查时代价已经显现，且中文输入基本不可用。

## What Changes

### C1 —— skills store 增 searchState / searchSkills 动作

`webui/src/lib/stores/skills.svelte.ts`：新增 `searchRequests` 代次门 +
`searchState {query, results, searching, error}` + `searchSkills(query,
limit?)`（镜像 loadSkills 样板：issue → `requireRpc().skills.search` →
isCurrent 提交 → isLatest 清 searching；空 query 不发请求直接清结果）。

### C2 —— ProviderView `q` 过滤切换后端检索

`webui/src/lib/apps/workspaces/ProviderView.svelte`：URL `q` 仍是唯一
真相源（REPLACE 导航不变）；输入 debounce(~150ms，组件内 effect + 定时器
清理) 后写 store 触发 `searchSkills`；列表渲染 searchState 投影（空 query
维持全量列表）；搜索失败时回退当前页已载技能的前端 includes 过滤 + 错误
提示（断线不空白）。

### C3 —— 命令面板全局 Skills 搜索组

`webui/src/lib/components/command-palette.svelte`：Cmd/Ctrl+K 面板增
异步 "Skills" 组（Command 原语 + CommandLoading）——输入经 debounce 走
`searchSkills`，结果按 workspace/provider 分组（组头从 installations +
workspaceState label 派生），选中 `goto(workspaces.provider?skill=…&
view=detail)`。窄屏沿面板既有 Dialog 行为。

### C4 —— composer `$` 菜单切 BM25 RPC

`webui/src/lib/components/agent/SkillMenu.svelte`：去全量拉取——
`$` 态 + 非空 needle 时 debounce(~150ms) `skills.search`，结果行从
`installations` 派生（组头 ws.label / provider.label），选中仍落
`$name` token + skill 三元组引用；空 needle 显示占位（不再渲染全量列表）；
断线保持 getRpc() 优雅失败先例；键盘导航/TriggerMenu 结构不动。

### 明确不在本 change

- ProviderView 搜索结果跨 workspace 化（保持 provider 内作用域，跨域走
  命令面板）；`$` 菜单最近使用/历史；搜索结果 ui:// 卡。

## 验证

store 单测（mock rpc 注入 skills.search，照 workbench-focused 模式）；
skill-menu 异步面组件测试；`pnpm check`/`pnpm build`；
**vision 子代理真实走查**（用户指定）：沙箱 HOME + fixture 技能 + pnpm dev
实例，桌面与窄屏（≤720px）覆盖 ProviderView 过滤 / 命令面板 / `$` 菜单三
链路 + console 零错误。
