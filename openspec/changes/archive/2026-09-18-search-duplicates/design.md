# Design: search duplicates

## D1 组投影语义

- 数据源：索引内存 stats + storedFields（不发查询）；分组键 =
  `contentHash`；仅保留成员数 >1 的组。
- 成员投影：`{id, name, canonicalPath, installations, disabled, conflict}`
  （name 从 storedFields；installations/stats 为 canonical 真相）。
- 排序（冻结）：组间按成员 canonicalPath 最小值 asc；组内按 canonicalPath
  asc——与搜索结果 tie-break 同族，列表稳定可重放。
- 新鲜度：`duplicates()` 与 `search()` 共用同一 freshen 路径（含 watcher
  clean 跳过语义）；不引入独立扫描。

## D2 契约

```text
SkillDuplicateGroupSchema = {
  contentHash: string(64),
  members: [{ id, name, canonicalPath, installations, disabled, conflict }]
}.strict()
skills.duplicates: input {} → output { groups: SkillDuplicateGroup[] }
```

capability：`skills.duplicates` readonly（无 mutation 面）；MCP 投影
`skills_duplicates` 自动可见（registry 既有规则，零专用代码）。

## D3 WorkspacesHome 区块

- 数据：`loadSkillDuplicates()`（独立代次门 + `$state {groups, loading,
error}`）；与 workspaces 列表同生命周期加载，断线/失败静默收起区块
  （错误信息在区块内一行文案，不 toast——非关键路径）。
- 渲染：区块标题「同内容技能 N 组」；每组成员行：name（重名省略）、
  作用域标签（installationScopeLabel 既有函数）、行点击 goById 到
  provider 详情；`disabled`/`conflict` 成员加既有 badge 语义。
- 空组（无重复）不渲染区块。

## 测试

- index 单测：分组/排序/成员投影/单成员不出现。
- RPC 集成：duplicates 返回形状 + readonly capability + MCP tools/list。
- webui：store 代次门单测；WorkspacesHome 渲染（有组/空态）组件测试。
