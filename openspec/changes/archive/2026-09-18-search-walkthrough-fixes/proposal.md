# Proposal: search walkthrough fixes — 真实语料走查修复（折叠多样性 + 同源角标）

## Why

用户真实语料走查 [2026-09-18] 暴露两项产品级缺陷与一项呈现裁决：

1. **搜索全空回归**：真实语料下同一技能存在 30+ 份跨 agent 的字节级副本。
   v1 排序管线「top-40 池按 BM25 取候选 → rerank → 之后折叠」在副本场景
   双重失效：(a) 40 个池位被同一内容的副本占满，折叠后结果只剩一两组，
   多样性消失；(b) 折叠代表只携带自身 installations（tie-break 使代表几乎
   总是 `~/.adal` 副本），ProviderView 按 provider 作用域过滤必然落空——
   GUI 消费方（ProviderView 过滤）在任何查询下都得到静默空白。
2. **「同内容技能」整屏区块裁决**：用户原话「如果你想表达某一个 skill 跟
   别的 skill 是同源的，那你就直接用浏览文件夹时 symbol link 的标识，
   对这个 skill 做一个小角标就好了」——首页区块形式废除，改为技能行上
   的 symlink 式小角标。

## What Changes

- **P1 ranking v2（池前折叠 + installations 合并）**：全量 BM25 候选先按
  contentHash 分组，组代表（bm25 desc → canonicalPath asc）进入 top-40
  竞争池——池位给不同内容，副本不再挤占多样性；primary 结果的
  installations 合并组内全部成员入口（primary 先、组内冻结序追加，按
  path+作用域三元组去重）；`RANKING_VERSION` 递增为
  `rerank-2026-09-18-v2`（触发一次全量重建）。冻结 rerank 公式与
  tie-break 不变；无重复语料的行为与 v1 完全一致（基准 R@5/MRR 不回退）。
- **P2 同源角标替代首页区块**：WorkspacesHome 删除「同内容技能」区块与
  duplicates 加载；ProviderView 列表行（SkillCard）与搜索结果行在技能名
  旁渲染 symlink 式小箭头角标（title = "Same content as N other
  installations"）；角标数据 = 连接后单发 `skills.duplicates` 构建的
  id → 组内其他成员数映射。RPC/store 契约不变。

## Impact

- 代码：`src/daemon/skill-search/ranking.ts`（v2 管线）、
  `webui/.../WorkspacesHome.svelte`（删区块）、`ProviderView.svelte`
  （角标 + duplicates latch）、`skill-card.svelte`（角标 prop）。
- 契约：`SkillSearchResult.installations` 语义从「primary 的安装」扩展为
  「该内容在全库的安装位置」（形状不变）；`duplicates` 附注不变。
- 不改：索引信封 schema、tokenizer/parser 版本、RPC/MCP 接口形状。
