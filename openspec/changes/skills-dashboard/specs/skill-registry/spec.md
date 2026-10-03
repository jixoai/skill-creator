# skill-registry 变更（增量：workspace 级有界聚合读）

## ADDED Requirements

### Requirement: skills.listWorkspace 提供有界的 workspace 级技能聚合读

`skills.listWorkspace`（readonly）MUST 聚合单一 workspace 全部 provider 的
技能为一份平铺投影（行携带 providerId 归属，providers 携带计数）。input
MUST 接受可选 `q`（server 端预过滤）、`limit`（1..500，默认 200）与
`cursor`（opaque 分段游标）；`limit` 越界 MUST 被输入 schema 拒绝为 typed
校验错误。单次响应的 `skills` 数组长度 MUST NOT 超过生效 `limit`；被截断时
响应 MUST 携带 `nextCursor`（缺席即末段）。聚合 MUST 复用本 spec 既有
discovery 语义（单遍扫描/在途合并/mutation 后失效），不引入第二条扫描
路径；duplicates 投影 MUST 与 `skills.duplicates` **数据同源**（成员/组
判定一致），但聚合投影按 design schema 做**有界包装**（组 ≤50 / 成员
≤16 / installations 为 `{items ≤8, truncated}` 包装而非裸数组——与
skills.duplicates 的成员形状**不同形**），完整数据经 `skills.duplicates`
获取。单 provider
扫描失败 MUST 仅投影为该 provider 条目的 `error` 字段
`{code: "unavailable" | "scan-failed" | "io-error", message}`，该 provider
的技能行缺席，响应整体成功。Global workspace（~）读取 MUST 与 Imported
workspace 同形（本 RPC 无写入面，不设写闸）。

#### Scenario: 单次响应有界

- **WHEN** 某 workspace 含 800 个技能且以默认 limit 调用
- **THEN** 响应 skills 数组长度 ≤ 200 并携带 nextCursor；经 nextCursor 续拉
  可达全部行，末段响应不再携带 nextCursor

#### Scenario: limit 越界是校验错误

- **WHEN** 调用传 limit: 501
- **THEN** 输入 schema 拒绝为 typed 校验错误，不返回截断的伪成功

#### Scenario: 单 provider 失败隔离

- **WHEN** 聚合期间一个 provider root 扫描抛错
- **THEN** 仅该 provider 条目携带 typed error 且其技能行缺席，其余 provider
  行正常返回，响应整体不失败

#### Scenario: Global 读取同形

- **WHEN** 对 Global workspace（~）调用 listWorkspace
- **THEN** 输出结构与 Imported workspace 完全一致（读取无差别，无写入面）

#### Scenario: q 预过滤为包含式且与游标兼容

- **WHEN** 以 `q: "vue"` 与默认 limit 调用，且命中数超过 limit
- **THEN** 返回行全部满足 name 或 description 包含 "vue"（大小写不敏感），
  续页（nextCursor）行满足同一过滤且与首页无重叠无遗漏

#### Scenario: 排序与续页不重不漏

- **WHEN** 全量拉取（多次 nextCursor 续拉至缺席）
- **THEN** 全部行按 (providerId, skillId) 字典序拼接后严格递增，无重复、
  无遗漏（与未过滤全集相等）

#### Scenario: duplicates 投影双层有界

- **WHEN** 某 workspace 存在 80 个 duplicates 组，其中一组有 30 个成员、
  某成员有 12 个 installations
- **THEN** groups 长度 ≤ 50 且 groupsTruncated = true；该组 members ≤ 16 且
  membersTruncated = true；该成员 installations.items 长度 ≤ 8 且
  installations.truncated = true（显式标志字段）；组/成员元素形状与
  skills.duplicates 数据同源（有界包装不同形——installations 为
  {items, truncated}）；全量经 skills.duplicates
