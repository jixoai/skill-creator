# skill-registry 变更（增量：首屏与读路径性能）

## ADDED Requirements

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
