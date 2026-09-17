# Design: skill-search-gui

> 消费方接线 change：`skills.search` RPC 合同已冻结（skill-search-integration），
> 本 change 全部在 webui/。详细接线点见编排者 recon（已内嵌实现简报）。

## 关键决策

1. **全局入口 = 扩展现有命令面板**（Cmd/Ctrl+K，+layout.svelte 全局挂载）
   加异步 Skills 组——Command 原语 + CommandLoading 为异步而生，零新导航
   模式；不在 WorkspacesHome 另做搜索框（避免双入口）。
2. **ProviderView 降级链**：searchState.error 时回退前端 includes（已载页
   数据）+ 错误提示——断线不空白，恢复后自动回到 BM25。
3. **`$` 菜单空态语义变化**：空 needle 不再渲染全量列表（916+ 技能不可浏览
   也不该拉），显示「输入关键词检索技能」占位——走查重点确认可用性。
4. **debounce 组件层实现**（仓库无通用工具）：effect + setTimeout，$effect
   清理函数回收定时器；store 保持无定时器纯代次门。
5. **组头派生**：搜索结果的 installations 只带 id——workspace label 查
   workspaceState，provider label 从 workspace.providers 反查；查不到的
   provider 用 id 兜底显示。

## 走查（用户指定 vision 子代理）

沙箱 HOME + SKILL_CREATOR_HOME + fixture 技能（含中文描述、同名多安装）
起 `pnpm dev` 独立实例；桌面（≥1024px）与窄屏（≤720px）覆盖：ProviderView
中英文过滤 + 断线降级、命令面板全局搜索到详情跳转、`$` 菜单中文/typo 检索
与引用落稿；console 零错误；截图留证。

## 测试

- `webui/src/lib/stores/__tests__/skills-search.test.ts`：mock rpc 模式
  （workbench-focused 先例）——空 query 不发请求、isCurrent 提交、断线
  generation 失效、error 态。
- `webui/src/lib/__tests__/skill-menu.test.ts`：异步空窗/占位/选中三元组。
- 门：pnpm check（含 webui check）/ pnpm build。
