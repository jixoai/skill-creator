## ADDED Requirements

### Requirement: 经 skills-CLI 安装的技能 MUST 被探测并标记 provenance

当 `npx skills list --json` 可用时，daemon MUST shell out 执行该命令、将 stdout 作为不可信外部输入经 Zod `safeParse` 解析，并按「技能路径 → 来源信息」建立映射。命中映射的技能，其 `SkillMetadata.installedVia` MUST 被设为 `"skills-cli"`，`updatable` MUST 反映「是否存在可用的 lock 条目」。探测不可用（无 npx / 非 0 退出 / 输出无法解析）时，`installedVia` MUST 回退为 `"unknown"`，且不得抛错。

#### Scenario: 命中 skills-CLI 探测的技能被标记为可升级

- **WHEN** daemon 探测到 `npx skills list --json` 返回某技能路径，且该路径同时落在某个已注册 Workspace Provider 的 server-owned 目录内
- **THEN** 该技能在 `skills.list` 返回项里 `installedVia = "skills-cli"` 且 `updatable = true`（前提是存在可用 lock 条目）

#### Scenario: 探测到的路径越界被视为无 provenance

- **WHEN** `npx skills list --json` 返回的 `skillPath` 不落在任何已注册 Workspace Provider 的 server-owned 目录内
- **THEN** 该条目被丢弃，对应技能的 `installedVia = "unknown"`、`updatable = false`，且不触发升级

#### Scenario: npx 不可用时技能列表照常返回

- **WHEN** 环境中没有 `npx`，或 `npx skills list --json` 非 0 退出 / 超时
- **THEN** `skills.list` 仍正常返回全部技能，所有技能 `installedVia = "unknown"`、`updatable = false`，daemon 进程不抛错、不退出

### Requirement: update-check MUST 对比 lock 文件 hash 与上游 hash

`update-check` RPC MUST 读取全局 `.skill-lock.json`（schema v3）与项目 `skills-lock.json`（schema v1），从中取出每个技能记录的 hash（`skillFolderHash` 或 `computedHash`）与 source。对 GitHub 源，MUST 通过 GitHub Trees API 取得上游 tree SHA 与之对比；对非 GitHub 源，MUST 浅克隆后按 skills-CLI 一致的算法计算 on-disk hash 再对比。RPC MUST 返回过时技能清单，每项至少包含 `skillId`、`currentHash`、`upstreamHash` 与 `source`。

#### Scenario: GitHub 源 tree SHA 不一致被报告为过时

- **WHEN** 某技能 lock 条目的 `sourceType` 为 GitHub，且 Trees API 返回的 tree SHA 与记录的 `skillFolderHash` 不相等
- **THEN** 该技能出现在 `update-check` 返回的过时清单中，`currentHash` = 记录值、`upstreamHash` = tree SHA

#### Scenario: 非 GitHub 源经浅克隆计算 hash 后对比

- **WHEN** 某技能 `sourceType` 非 GitHub（如本地 git 仓库），且浅克隆后算出的 on-disk hash 与记录的 `computedHash` 不相等
- **THEN** 该技能出现在过时清单中，`upstreamHash` = 新算出的 hash

#### Scenario: 已是最新则不在过时清单中

- **WHEN** 记录 hash 与上游 hash 相等
- **THEN** 该技能不出现于过时清单

### Requirement: apply-update MUST 经既有安装流水线重装并刷新 lock 条目

`apply-update` RPC MUST 对被批准的过时技能，用 lock 条目记录的 `{source, ref}` 触发一次 pinned-clone 安装（复用 `repository-service.ts` 的 `scan` + `install` 路径），安装到原 target。安装成功后，MUST 用新 commit / 新 hash 刷新对应 lock 条目的 hash 字段与 `updatedAt`。失败（克隆失败 / 安装冲突 / containment 失败）MUST 透传为既有 `DomainError`，且不得留下半装状态。

#### Scenario: 成功重装并刷新 hash

- **WHEN** 用户对某过时技能调用 `apply-update`，且重克隆 + 安装全部成功
- **THEN** 该技能被装回原 target，对应 lock 条目的 hash 字段与 `updatedAt` 被刷新为最新值，技能从下一次 `update-check` 的过时清单中消失

#### Scenario: 安装冲突按既有错误语义失败

- **WHEN** apply-update 触发的安装遇到 overwritten / containment 失败
- **THEN** 透传既有 `DomainError`，lock 条目保持不变，不写入任何半装文件

### Requirement: 不可解析或缺失的 lock 文件 MUST 优雅降级

读取全局 / 项目 lock 文件时，MUST 用 Zod `safeParse` 校验。文件不存在、非 JSON、或 schema 不兼容时，MUST 视作「无 provenance」——对应技能在列表中照常出现但 `updatable = false`、`installedVia = "unknown"`。MUST NOT 将解析失败上升为错误或终止 `skills.list` / `update-check`。

#### Scenario: 不兼容的 lock schema 不影响技能列表

- **WHEN** `.skill-lock.json` 存在但其结构不符合 vendored v3 schema
- **THEN** 该文件被当作 `null` 处理，全部技能 `installedVia = "unknown"`、`updatable = false`，`skills.list` 正常返回

#### Scenario: lock 文件不存在视为无 provenance

- **WHEN** 既无全局也无项目 lock 文件
- **THEN** 所有技能照常列出，`updatable = false`，不报错

### Requirement: GitHub API 失败 MUST 不使 update-check 崩溃

GitHub Trees API 调用失败（无 token、限流、网络错误、5xx）时，`update-check` MUST 不抛错。受影响的 GitHub 源技能 MUST 在返回结果中被标记为「上游不可达」，而非缺失或误判为已最新。未认证调用 MUST 受 60 次/小时限制，并在超限时一并标记「上游不可达」。

#### Scenario: 限流时报告上游不可达

- **WHEN** 未提供 `GITHUB_TOKEN`/`GH_TOKEN`，且 GitHub API 返回 403 限流
- **THEN** `update-check` 不抛错，受影响技能被标记为「上游不可达」，其余非 GitHub 源技能仍照常对比

#### Scenario: 无网络时 update-check 报告而非崩溃

- **WHEN** 调用 Trees API 时网络不可达
- **THEN** `update-check` 返回正常响应，受影响技能标记为「上游不可达」，daemon 不退出

### Requirement: update-check 结果 MUST 区分 updated / already-current / failed / unavailable

`update-check` 的返回结构 MUST 用判别字段区分每个被检查技能的状态：`updated`（hash 改变，待升级）、`already-current`（hash 相等）、`failed`（检查过程出错，如克隆失败）、`unavailable`（上游不可达，如限流 / 无网络）。MUST NOT 把 `failed` 与 `unavailable` 合并为同一状态，以便 UI 分别提示「出错可重试」与「暂时无法检查」。

#### Scenario: 四种状态在单次检查中可并存

- **WHEN** 一次 `update-check` 同时覆盖一个过时技能、一个已最新技能、一个克隆失败技能、一个被限流的 GitHub 技能
- **THEN** 返回结果对四者分别标记 `updated`、`already-current`、`failed`、`unavailable`

### Requirement: apply-update 结果 MUST 区分 updated / already-current / failed

`apply-update` 的返回结构 MUST 用判别字段区分每个被处理技能的最终结果：`updated`（重装成功且 hash 刷新）、`already-current`（执行前已与上游一致，未实际重装）、`failed`（重装或 lock 刷新失败）。失败项 MUST 携带可展示的错误原因。

#### Scenario: 已最新技能在 apply 时被跳过

- **WHEN** 用户对某技能调用 `apply-update`，而该技能在执行时已被外部更新为最新 hash
- **THEN** 该技能结果被标记为 `already-current`，不发生重装，lock 条目不变

#### Scenario: 失败项携带错误原因

- **WHEN** apply-update 中某技能重克隆失败
- **THEN** 该技能结果被标记为 `failed` 并附带错误原因字符串，其余成功项仍按 `updated` 返回
