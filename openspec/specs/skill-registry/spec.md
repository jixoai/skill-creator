# skill-registry Specification

## Purpose

workspace 与 skills 读路径的服务端投影契约：单遍扫描产出、在途合并与
失效纪律——保证投影与磁盘真相一致的前提下压低重复 discovery 成本。

## Requirements

### Requirement: workspace 列表投影单遍扫描产出计数与键

`registry.list()` 的动态投影 MUST 以单次 per-root discovery 同时产出
skillCount 与 skill key 集（不再对同一 root 跑两遍全量扫描）；投影期间
MUST 保持既有 revision-retry 一致性语义。非 claude-code provider 的
root 扫描 MUST 跳过 Claude 插件发现全局副作用；claude-code provider 的
插件技能语义 MUST 保留。

#### Scenario: 单遍投影

- **WHEN** workspace.list 在多 provider 语料上执行
- **THEN** 每个 root 的 discovery 只执行一次，counts 与 keys 来自同一份
  结果

#### Scenario: 非插件 provider 无插件扫描副作用

- **WHEN** 扫描 ~/.codex 等 root
- **THEN** 不触发 ~/.claude settings/plugins 的读取与插件目录扫描

### Requirement: skills 读路径的 discovery 在途合并与 probe 预热

`skills.list` MUST NOT 阻塞等待 skills-CLI probe 的首次完成；daemon 启动
后 MUST 后台预热 probe，probe 未到位时 provenance 投影为缺省并在到位后
的下一次投影中补全。同 target 的并发读（`list`/`resolveSkill`/`info`/
`validate` 同时在途时）MUST 共享同一次 discovery；**跨请求不缓存**（曾按
3s TTL 实现并实测否决：steward/creator/测试 fixture 的「直接写盘→再读」
对缓存不可见，写后读一致性优先——跨请求缓存留给索引化投影）。所有改变
磁盘状态的写路径（`toggle`、creator save/delete、steward apply/rollback、
repository install）完成后 MUST 调用 discovery 失效（invalidateDiscovery），
使后续读重新扫描。

#### Scenario: 首次进 provider 不等待 npx

- **WHEN** daemon 刚启动且 probe 未完成时调用 skills.list
- **THEN** 调用不被 npx 阻塞，列表正常返回（provenance 字段缺省）

#### Scenario: mutation 后缓存失效

- **WHEN** toggle 技能启用/禁用后立刻 resolveSkill
- **THEN** 结果反映新状态（.SKILL.md 变化可见），不来自过期缓存

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
