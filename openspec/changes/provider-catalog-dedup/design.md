# Design: provider-catalog-dedup

## 联审结论

立场：**需修订后可立项**。

提案抓住了 O1 的真实问题：catalog 的声明数被误读成物理位置数，导致 Agents
屏和库快照计数膨胀。物理根聚合是正确的产品方向，但“只改投影与计数聚合层、契约
不动”需要收窄为两个层次：`WorkspaceProviderTarget = { workspaceId, providerId }`
和 provider 声明全集必须保持不变；`Workspace` 的只读响应需要新增一个
`physicalRoots` 投影字段，供展示和位置计数消费。这是 read envelope 的加法，不是
把物理根替换成 Provider 身份，也不是改变 catalog 或安全契约。

| 张力                                | 联审立场 | 裁决                                                                                                    |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| realpath 时机与成本                 | 需修订   | 在 `workspace.list` snapshot 惰性解析；每个作用域内每个 lexical root 一次，不在 boot 预热或跨请求缓存。 |
| 声明者标签密度                      | 需修订   | daemon 返回全量；首屏最多 3 个标签，超出显示 `+N`，完整集合进 title/popover/aria。                      |
| Imported / Global 口径              | 可立项   | 两者都按物理根计数，但 grouping map 先按 `workspaceId` 分区，绝不跨作用域合并。                         |
| 与 skill-search canonicalize 的边界 | 可立项   | 复用 canonical path 语义和 helper 测试，不复用索引、watch cache 或 installations 身份。                 |

### 提案的段落级修订

以下文字作为 `proposal.md` 对应段落的定稿替换，保留原提案作为立项背景，不在本轮
直接改写提案文件。

**What Changes 1（投影去重）替换为：**

> Provider catalog 继续完整发现并投影每个 provider declaration。`Workspace` read
> projection 另增 `physicalRoots`：在同一 Workspace 作用域内，把 realpath 相同的
> declaration 聚合为一行；行上保留完整的声明者 ID/label 列表。`providers` 数组
> 不删、不合并，继续作为 provider-scoped 导航、授权和 mutation 的身份源。

**What Changes 2（口径重定义）替换为：**

> 物理根行的 `available`、`skillCount` 和 location 数按物理根计算：同一根下的
> 技能目录名取 union，每个根只计一次。现有 `WorkspaceProvider.skillCount` 与
> `skills.listWorkspace.providers` 继续表达单个声明的原始/作用域计数，供 provider
> facet 和 target 操作使用；任何“agent locations”文案改用 `physicalRoots.length`。

**What Changes 3（少即是多）替换为：**

> Agents 屏以 `physicalRoots` 为主行，声明者在行内按 catalog 顺序展示最多 3 个
> 标签，剩余以 `+N` 收纳，完整集合由 title/popover 提供。需要筛选、findings、
> evaluation 或 mutation 时，用户从声明者标签进入原有 `?provider=<providerId>`
> 路径，物理根行不伪装成新的 Provider。

**What Changes 4（边界）替换为：**

> catalog 的发现面、`Workspace.providers` 声明语义、Provider target 三元组的安全
> 边界、skill-search 的 canonical skill 与 installations 均不变。实现只扩展
> workspace read projection 和其展示/计数聚合；不持久化 physical root，不改 Creator、
> Repository、Evaluation、Steward 或 Agent 的 target 解析。

**Verification 替换为：**

> Alpha fixture 覆盖多声明共享根、不同根、缺失根和 symlink 根：`workspace.list`
> 返回一根一行，声明者完整可见，根技能 union 和 location count 去重；Global 与
> Imported 相同物理目录仍各自计数。Agents 屏与库快照消费物理根计数；Skills 屏的
> provider chips、findings 链接、可写 targets 和 search installations 保持原作用域。

## Context

当前 daemon 由完整 `PROVIDER_CATALOG` 派生每个 Workspace 的 `providers` 数组。
同一物理目录（例如多个工具共同约定的 `~/.agents/skills`）因此以多个声明行出现。
`workspace-registry/projection.ts` 已经在一次扫描中按 canonical root + directory
name 做 Workspace 级技能 union，但 Agents 屏仍把 provider 级计数相加，位置摘要也
把声明数当成位置数。

`WorkspaceProviderTarget` 是所有 provider-scoped 读取和 mutation 的寻址边界；
`workspace-targets.ts`、Creator、Repository、Evaluation、Agent 会话和 domain
授权都依赖完整的 provider 声明。skill-search 另有自己的 `canonicalPath` 分组，
并保留 `{path, workspaceId, providerId}` installations，故它的 canonical skill
身份不能替代 Workspace 的 Provider target。

## Goals / Non-Goals

**Goals:**

- 在每个 Workspace read projection 中增加物理根聚合，给每根稳定 key、展示路径、
  可用性、union skill count 和完整声明者列表。
- 同一 Workspace 作用域内按 canonical realpath 合并；realpath 失败时按 normalized
  absolute lexical path 形成 unavailable fallback 行。
- 让 Agents 屏和 agent-location 摘要按物理根计数，同时保留 provider-scoped facet
  和操作入口。
- 让同一份 snapshot 扫描结果同时产出 provider 原始计数、Workspace skill union 和
  physical-root union，避免再跑 ccski 扫描。

**Non-Goals:**

- 不减少或修改 `PROVIDER_CATALOG`，不改变 Global/Imported 的 root 解析约定。
- 不把 `Workspace.providers` 改成物理根列表，不删除或重写 `{workspaceId, providerId}`。
- 不合并 Global 与任一 Imported Workspace，即使它们的 realpath 相同。
- 不改变 `skills.listWorkspace` 的 provider 分页、filter、cursor 或
  skill-search 的 canonical documents/installations。
- 不持久化 physical-root 结果，也不建立跨请求 realpath 缓存、watcher 或索引生命
  周期；动态列表仍是 snapshot 投影。

## Decisions

### 1. Additive read projection，声明与 target 保持原样

`WorkspaceSchema` 在现有 `providers` 旁增加 `physicalRoots`。每个物理根行包含：

```text
physicalRoots[] = {
  key: string,                 // canonical realpath；失败时 normalized absolute fallback
  path: string,                // key 的展示路径
  available: boolean,
  skillCount: number,          // 该根内 directoryName 的 union
  declarers: [{ id, label }]   // 完整 catalog 顺序；不含“物理根身份”
}
```

`providers` 仍是完整 declaration projection，`declarers[].id` 仍可回到同一条
`WorkspaceProviderTarget`。物理根没有新的可写权限或 mutation API。声明者标签点击
沿用现有 provider filter/findings 路由；多声明行的默认交互是先选择具体声明者，单
声明行可直接进入。

备选方案是直接把 `providers` 改成物理根行。该方案会让 `workspace-targets.ts` 丢失
可写目标、让 `domain.ts` 无法验证隐藏 provider，并把同一根下可能不同的 ccski
provider 语义错误地合并，因此拒绝。

### 2. Snapshot 内惰性 realpath，一根一次

不在 daemon boot 预计算，也不做跨请求缓存。`workspace.list` 的 immutable snapshot
阶段解析 root：在一个 `(workspaceId, lexicalRoot)` 内只执行一次
`canonicalDirectory`/`realpath`，并把结果放入本次 snapshot 的 grouping map；同一份
扫描结果直接复用该 key。这样成本是每个作用域的 root 数量级，而不是技能条目数量级，
也不会把 symlink 变化或目录恢复后的陈旧结果留在 daemon 内。

解析流程如下：

```text
catalog declaration
       |
       v
lexical root -- realpath/dir check --> canonical physical key
       |                                  |
       | failure                          | success
       v                                  v
normalized absolute fallback        available root group
unavailable root group
       |
       +--> same-snapshot scan entries --> skill-name union + declarer list
```

`root === null`（catalog 明确不支持该作用域）不是物理位置，不创建 physical-root
行；它仍保留在 `providers` 中并显示为不可用声明。realpath 在 stat 后发生竞态失败
时使用 fallback key、标记该行 unavailable，并让下一次 snapshot 重新观察。

不复用 skill-search 的索引缓存或 watcher。两处只共享 canonicalization 的路径语义
和现有 `canonicalDirectory` 辅助函数；skill-search 仍按自己的入口生命周期管理
`canonicalPath`。

### 3. 计数分层，防止展示去重穿透安全边界

扫描时每个 declaration 仍生成原始 `provider.skillCount`；同一物理 key 的 entries
按 `directoryName` union 形成 `physicalRoot.skillCount`。Workspace 的 `skillCount`
继续使用 canonical root + directoryName 的 union，因此物理根行之和与 workspace
级 canonical union 对齐。Provider facet、`skills.listWorkspace.providers`、skill
详情及 findings 继续使用声明级计数和三元组。

Agents 屏的总 skill 数读取 Workspace 的 canonical `skillCount`（或等价的
physical-root union），行数读取 `physicalRoots.length`。Global 页脚/库快照保留现有
作用域选择逻辑，只把“agent locations”的内层计数替换为各 Workspace 的
`physicalRoots.length`；不把 provider 数重新命名后继续当位置数。

### 4. 声明者标签采用完整数据、压缩首屏

daemon 返回完整声明者集合，按 catalog 首次出现顺序稳定排列，避免同一根的标签因
字母排序或异步扫描顺序抖动。Agents 行首屏最多显示 3 个 label，超出显示 `+N`；
title/popover/可访问名称提供完整列表。每个可操作声明者保持 provider ID，标签只是
物理行的次级信息，不能作为新的 target ID。

### 5. Global 与 Imported 按 Workspace ID 隔离

聚合 map 的第一层 key 是 `workspaceId`，第二层才是 canonical physical key。Global
和 Imported 即使指向同一目录也分别生成行、分别计算 count；Global 的 rows 继续只读，
Imported 的具体 declaration 继续承担 writable target。跨 Workspace 合并会把
不同安全作用域的观察误当成同一可操作资源，因此拒绝。

### 6. 与 skill-search 的复用边界

`skill-search/canonicalize.ts` 的 `realpathSync` 分组和 installations 证明了路径
归一化的既有语义，但不能作为 Workspace projection 的数据源：search 需要保留同一
canonical skill 的所有 installations，且会过滤/折叠内容重复；物理根投影只关心当前
Workspace 的 root 和 directory-name union。实现复用 helper/测试语义即可，不共享
search index、stat envelope、watch cache 或 installation 合并。

## Risks / Trade-offs

- **[realpath 同步 IO 增加 list 延迟]** → 在已有 workspace snapshot 扫描内按 lexical
  root memoize，一根一次；不在 boot 预热，不对每个技能重复 realpath；测试记录共享
  根的调用次数。
- **[root 在 snapshot 中途消失]** → canonical 失败落到 normalized fallback，行保留但
  `available=false`；下一次 list 重新解析，不能把缺失根并入成功 realpath 根。
- **[标签过密或截断造成误解]** → 返回完整 declarers；首屏只压缩视觉标签，`+N` 与
  title/popover/aria 文本提供全量；操作必须落到具体 provider ID。
- **[物理根 union 与 provider 扫描语义不同]** → 仅在 physical-root/workspace
  展示计数做 directoryName union，保留 provider raw counts 和 search installations，
  并用同一 snapshot fixture 钉住两种口径。
- **[新增 read 字段造成旧 fixture/消费者失败]** → 破坏性更新按仓库惯例一次性更新
  shared Zod schema、daemon projection、WebUI stores/tests；无持久化迁移，无兼容胶水。
- **[跨作用域误合并泄露计数]** → grouping map 强制以 workspaceId 分区，加入 Global
  与 Imported 同 realpath 的回归测试。

## Migration Plan

1. 先扩展 shared workspace read schema/type 与 projection test seam，再在同一变更中接入
   Agents screen、location summary 和 fixtures；provider target、catalog 与 search
   contracts 不迁移。
2. 运行 focused daemon/WebUI tests、`pnpm --dir webui check`、显式文件 fmt 与
   `git diff --check`。桌面和窄屏走查确认物理根行、标签收纳、声明者操作入口。
3. 发布时无磁盘迁移：physicalRoots 每次由当前 snapshot 重算。若需回滚，恢复旧的
   daemon/WebUI 成对版本即可；旧版本仍读取它自己的 providers 投影，registry 和
   search 索引文件不受此 change 影响。
