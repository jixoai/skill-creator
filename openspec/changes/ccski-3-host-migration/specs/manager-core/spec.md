# manager-core 增量（ccski 3.0 启停与更新内核化）

## ADDED Requirements

### Requirement: 技能启停按 ownership 双路由

`skills.toggle` MUST 按发现层 ownership 路由：`ownership === "ccski"` 的技能走内核 `toggleEntityProjection`（link 投影摘链/重链的物理禁用语义；materialized 副本走内核 ccski-legacy 约定）；其余技能（external/unknown 链接、普通目录）走宿主文件改名（`SKILL.md` ↔ `.SKILL.md`）。顶层 symlink 条目的宿主改名 MUST 被守卫拒绝为 typed conflict（rename 穿过链会改写 server-owned root 之外的内容）。内核 typed error（ENTITY_REVISED/GUARD_PROJECTION/FOREIGN_OWNERSHIP）MUST 映射为 conflict 且不覆盖目标；内核 message 不透传。

#### Scenario: 摘链物理禁用

- **WHEN** 对 ccski link 投影技能执行 disable
- **THEN** Provider root 下链接物理消失（摘链），共享实体保持 enabled 形态原样在场

#### Scenario: 禁用补充行与往返闭合

- **WHEN** link 投影摘链后以 includeDisabled 读取该 provider 列表
- **THEN** 同 id 的 disabled 补充行在场（state 记录 + 实体内容源），对其 re-enable 经内核重链恢复投影

#### Scenario: 非 ccski 文件改名

- **WHEN** 对非 ccski 管辖的普通目录技能执行 disable
- **THEN** 走宿主文件改名路径，`SKILL.md` 换名为 `.SKILL.md`

#### Scenario: typed 冲突映射不透传

- **WHEN** 内核启停返回 GUARD_PROJECTION/ENTITY_REVISED/FOREIGN_OWNERSHIP
- **THEN** 该条目投影为 conflict 并携带 ccski code token，内核原始 message 不泄露

### Requirement: skills 更新以内核单源 hash 与代际收敛

`skills.update` 的 hash 对比 MUST 消费内核导出的 `computeSkillFolderHash` 单源（宿主不得维护第二实现）；apply MUST 走内核实体 update（2.x 重装路径退役）。存量 lock 的 40-hex 旧算法条目 MUST 视为 stale 触发重装收敛——收敛的 hash 覆盖层是 daemon 内存态（npm lock 唯一写者是 skills CLI，宿主不落盘），因此收敛语义为「daemon 生命周期内一次」：同一 daemon 内 apply 后 recheck 为 already-current，不伪装成功；daemon 重启后若 lock 仍持 40-hex 旧值，该项再次判 stale 重新收敛。lock 或 GitHub API 不可用 MUST 投影为 skipped/unavailable（不抛基础设施错误、不伪装成功）；apply 成功条目 MUST 诚实携带 `lockSyncPending: true`（分层单写者恒定，宿主只在内存覆盖层刷新 hash）。

#### Scenario: 40-hex 代际收敛

- **WHEN** 存量 lock 条目的 computedHash 为 40-hex 旧算法值且上游可用
- **THEN** check 将该项判为过时，apply 重装一次以新算法 hash 收敛；同一 daemon 生命周期内再次 check 报 already-current（覆盖层为内存态，重启后若 lock 仍为 40-hex 则再次收敛）

#### Scenario: 不可用诚实投影

- **WHEN** lock 读取失败或 GitHub Trees API 不可用
- **THEN** 相关项投影为 skipped/unavailable，不伪装成功也不让基础设施错误抛出

#### Scenario: lockSyncPending 携带

- **WHEN** apply 成功重装一项技能
- **THEN** 该项结果携带 `lockSyncPending: true`（宿主不写 npm lock）
