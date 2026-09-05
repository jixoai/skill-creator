## Context

Skill Creator 通过 ccski 发现本地技能，但完全不知道这些技能是怎么来的：是用户手写的、还是 `npx skills add` 装的、装自哪个仓库哪个 ref。`vercel-labs/skills` CLI 没有可 import 的 SDK（`package.json` 无 `exports/main/types`），它把 provenance 写进两个 lock 文件——全局 `.skill-lock.json`（schema v3，位置 `$XDG_STATE_HOME/skills/` 或 `~/.agents/.skill-lock.json`）与项目 `skills-lock.json`（schema v1，cwd 根）。

v3 全局条目：`{source, sourceType, sourceUrl, ref?, skillPath?, skillFolderHash, installedAt, updatedAt, pluginName?}`，其中 `skillFolderHash` 是 GitHub tree SHA。v1 项目条目：`{source, sourceUrl?, ref?, sourceType, skillPath?, computedHash, subagents?}`，其中 `computedHash` 是 on-disk 文件的 SHA-256。

Skill Creator 的 update 模型天然就是「对比 stored hash 与 upstream hash，不一致就重跑安装」。本变更把 skills-CLI 的 lock 文件接进这条模型：探测 `npx skills list --json` 给出 path→provenance 映射，读 lock 拿到 hash，按源类型对比上游，差异即触发复用现有 `repository-service.ts` 流水线的重装。

相关代码现状：`SkillMetadataSchema`（`src/shared/contracts/skills.ts`）只表达身份与可读性，无 provenance；`rpcContract`（`src/shared/rpc-contract.ts`）有 `skills`/`workspace`/`creator`/`repository`/`daemon` 五个命名空间，`repository.install` 已封装 pinned-clone 安装；`rpc-router.ts` 是唯一的 RPC 边界与 `DomainError` 收口点。安全不变量要求：所有跨进程输入走 Zod safeParse、WebUI 不直接读盘、路径 server-owned + containment check。

## 状态分层（来自 config.yaml 原则）

本变更的**所有业务状态全部归 daemon 层**——lock 文件、provenance 探测、upstream hash、update-check 结果都是持久 + 共享状态，浏览器是纯视图层：

| 状态                                            | 存储层                                                                | 说明                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| skills lock 文件（v3 全局 / v1 项目）           | **daemon**（读：`skills-lock.ts` safeParse；写：apply-update 时刷新） | 持久 + 共享；浏览器不读盘                                 |
| provenance 探测（path → source）                | **daemon**（`npx skills list --json` + 缓存，见 D6）                  | daemon 生命周期内缓存                                     |
| upstream hash（GitHub tree SHA / on-disk hash） | **daemon**（按 `{owner,repo,ref}` 缓存）                              | daemon 生命周期内缓存                                     |
| `installedVia` / `updatable` badge              | **daemon RPC `skills.list` 投影**                                     | 浏览器从 RPC 响应渲染，**不缓存在前端 memory 跨渲染周期** |
| update-check 结果                               | **daemon RPC `skills.update.check`**（用户触发）+ 可选 WS 推送        | 浏览器收到后渲染，不缓存                                  |
| 用户在 UI 的选中 / 筛选 / 子视图                | **URL search params**（归 change 0/1 Shell 标准）                     | 视图状态真相源                                            |

**禁止**：把 lock 数据、provenance、upstream hash、update-check 结果缓存在前端 memory 跨渲染周期；把它们写入 localStorage。

## 数据流

```
npx skills list --json ──> daemon probe ──> map skill path → provenance
                                                  │
.skill-lock.json (v3) ───────────────────────────┤   (safeParse, 失败 → null)
skills-lock.json (v1) ───────────────────────────┤   (daemon 侧读取，浏览器不读盘)
                                                  v
                                    skill.metadata.installedVia = "skills-cli"
                                    skill.metadata.updatable = has lock entry
                                                  │
skills.list RPC ──────────────────────────────────┘ 投影含 installedVia/updatable
                                                  │ (浏览器从 RPC 渲染，不缓存)
                                                  v
update-check RPC <────────────────── user triggers (daemon 侧计算 + 缓存 upstream hash)
        │
        ├─ GitHub source: fetch Trees API → compare tree SHA vs skillFolderHash
        └─ other source:  clone → computeSkillFolderHash → compare
                  │
                  v
        outdated skills list [{skillId, currentHash, upstreamHash, source}]
                  │ (浏览器收到结果渲染；可选 WS 推送刷新)
apply-update RPC <────────────────── user approves
        │
        └─ re-clone pinned source → install via existing pipeline → refresh lock entry (daemon 侧)
```

## Goals / Non-Goals

**Goals:**

- 让 Skill Creator 区分「经 skills-CLI 安装的技能」，并在技能列表里显示可升级 badge——badge 数据来自 daemon `skills.list` 投影，**不缓存在前端 memory**。
- 提供可观测的 update-check：用户主动触发，daemon 侧返回过时技能清单（含 current/upstream hash 与 source）；浏览器收到 RPC 响应（或 WS 推送）后渲染，不缓存。
- 提供可控的 apply-update：用户逐项确认后才重装，复用既有 pinned-clone 安装流水线，并在 daemon 侧刷新对应 lock 条目。
- 全程外部输入 safeParse、缺 npx/无网络/无 token 静默降级、不崩溃。
- 状态分层合规：lock 数据 / provenance / upstream hash / update-check 结果全部 daemon-owned，浏览器是视图层。

**Non-Goals:**

- 不重新实现完整的 skills CLI——只 shell out + 读 lock。
- 不在版本间迁移 lock 文件 schema（v1↔v3 互转）。
- 不接管 `skills add` / `skills remove`（用户仍直接用 CLI 做增删，Skill Creator 只做发现 + 升级）。
- 不自动后台轮询升级；升级永远是用户显式触发。
- 不为非 skills-CLI 安装的技能（`installedVia: "manual"`）计算 hash 或推断上游。
- 不在前端 memory / localStorage 缓存 lock 数据、provenance、update-check 结果（违反状态分层）。

## Decisions

### D1: lock 文件 schema 作为 vendored Zod schema 收进 shared/contracts（daemon 侧读写）

lock schema（v3 全局 + v1 项目）以 Zod schema 写进 `src/shared/contracts/skills-lock.ts`，与 daemon 共享同一份运行时校验。**读取与写入都在 daemon 侧**——浏览器永远不直接读盘，lock 数据不缓存在前端 memory 跨渲染周期，也不写 localStorage。读取一律 `safeParse`，解析失败返回 `null`——该技能视为「无 provenance」而非错误。理由：破坏性更新原则要求「不兼容按空值加载」，且 lock 文件是第三方产物、随时可能 schema drift，不能让一次版本升级打挂整个技能列表。
备选：在 daemon 里用 ad-hoc 类型断言读取——被否，违反「type-safe = runtime-safe」核心约束，外部 JSON 必须过 Zod。

### D2: `npx skills list --json` 输出按不可信外部输入处理

shell out 的 stdout 是 `unknown`，先 `safeParse` 成「skill path + 源信息」的最小子集 schema，丢弃不兼容的条目（如缺 `skillPath` 或路径越界）。npx 进程的 exit code 非 0 / 超时也只记日志、不抛错。
备选：要求用户在 Skill Creator 里登记 skills-CLI 路径——被否，用户已声明要「自动区分经 npx-skills-cli 安装的技能」，强迫登记等于失败。

### D3: GitHub 源用 Trees API 取上游 hash，其余源浅克隆后算 on-disk hash

对于 GitHub 仓库源：解析 `sourceUrl` 得到 `{owner, repo}`，对 `ref` 调 GitHub Trees API（`GET /repos/{owner}/{repo}/git/trees/{ref}`）取 tree SHA，与 lock 里存的 `skillFolderHash`（本身就是 tree SHA）直接字符串对比。优先读 `GITHUB_TOKEN`/`GH_TOKEN`，无 token 走未认证（受 60 次/小时限流），并把结果按 `{owner,repo,ref}` 在 daemon 生命周期内缓存。
对于非 GitHub 源：浅克隆到 daemon 临时目录，用与 skills-CLI 一致的算法算 `computeSkillFolderHash`（SHA-256 of on-disk 文件），与 lock 里 `computedHash` 对比。
理由：GitHub tree SHA 是现成的「目录指纹」，无需克隆、最省网络；非 GitHub 没有等价物只能克隆。两者最终都收敛到「字符串相等 == 已最新」。
备选：对所有源统一浅克隆算 hash——被否，GitHub 源数量大时限流严重、且 tree SHA 已是官方约定。

### D4: apply-update 复用 `repository-service.ts` 安装流水线

apply-update 不自建安装路径，而是：把 lock 里记录的 `{source, ref}` 当作一次 `repository.scan`（pinned clone），从中选出对应技能，走既有 `repository.install`（ccski install 到原 target），成功后用新 commit / 新 hash 重写 lock 条目的 `skillFolderHash` / `computedHash` 与 `updatedAt`。
理由：安装逻辑（pinned、containment、overwritten 语义、错误码）已在 repository-service 收敛一次，重复实现会绕过安全不变量。
备选：直接 `npx skills add <source>@<ref> --force`——被否，绕过 Skill Creator 的 pinned-session 与 target 校验，且每次都触发 npx 冷启动。

### D5: provenance 字段为可选 + 判别联合，破坏性更新不向下兼容（daemon RPC 投影）

`SkillMetadataSchema` 增 `updatable?: boolean` 与 `installedVia?: z.enum(["skills-cli","manual","unknown"])`。这两个字段是 **daemon `skills.list` / `skills.info` RPC 投影**的一部分——浏览器从 RPC 响应里拿到后渲染 badge，**不缓存在前端 memory 跨渲染周期**，每次列表渲染都从最新 RPC 投影取值。老 WebUI 不认这些字段时按默认值（`updatable=false`、`installedVia="unknown"`）渲染；新 WebUI 收到老 daemon（无字段）同样走默认。不做字段版本协商。
理由：与项目「破坏性更新不做向下兼容、schema 不兼容按空值加载」一致；provenance 是增强信息，缺失不影响技能列表的核心可用性；把 provenance 放 daemon 投影而非前端 memory 符合状态分层（持久 + 共享状态归 daemon）。

### D6: 探测结果与 upstream hash 在 daemon 生命周期内缓存（浏览器不缓存）

`npx skills list --json` 有冷启动成本（解析包、启动 node）。一次 probe 结果按「技能 path → provenance」**缓存在 daemon 生命周期内**，不在每次 `skills.list` RPC 时重跑；仅在 `update-check` / `apply-update` 成功后失效对应条目。npx 启动失败时缓存为空 map，下一轮 RPC 仍可重试。upstream hash（GitHub tree SHA / on-disk hash）同样按 `{owner,repo,ref}` 缓存在 daemon 侧。

**浏览器侧不缓存这些**：update-check 结果由用户触发 `skills.update.check` RPC 拿到（一次性响应）；后续若 daemon 侧 hash 缓存失效或检测到上游变化，通过 WS 推送通知浏览器重新拉取 `skills.list` 投影刷新 badge——浏览器永远是视图层，不维护 lock / hash / provenance 的前端副本。

## Risks / Trade-offs

- **GitHub API 限流** → 优先读 `GITHUB_TOKEN`/`GH_TOKEN`；未认证按官方限制；tree SHA 按 `{owner,repo,ref}` 缓存 daemon 生命周期；超限时 `update-check` 返回 `unavailable`（不报错、不崩）。
- **npx 冷启动开销** → probe 结果 daemon 生命周期内缓存；用户手动触发 update-check 时才重跑探测；不在每次列表 RPC 触发。
- **lock 文件 schema drift** → schema 集中在 `skills-lock.ts`，`safeParse` 失败降级为「无 provenance」；按 vercel-labs/skills 发版节奏周期性 re-vendor。
- **`npx skills list --json` 输出不稳定** → 只取最小子集（path + source 字段），多余字段忽略；解析失败的条目单独丢弃而非整批失败。
- **apply-update 期间用户在 WebUI 编辑同一技能** → 沿用 `repository.install` 的 overwritten 语义 + containment check；刷新 lock 条目前再次确认 target 可写。
- **路径越界 / 伪造 lock 指向任意路径** → lock 里的 `skillPath` 必须落在已注册 Workspace Provider 的 server-owned 路径内，否则视为「无 provenance」，不允许 update。

## Migration Plan

本变更为纯增量 + 字段扩展，无数据迁移：

1. 先落 `skills-lock.ts` schema + 单测（不接 daemon），保证 safeParse 行为先就位。
2. 再落 probe + provenance 投影，`skills.list` 输出新字段；老 WebUI 因可选字段自动降级，可独立部署。
3. 最后接 `update-check` / `apply-update` RPC 与对应 UI；上线前默认行为仍是 `updatable=false`（探测失败/无 npx 时），逐步灰度。

回滚：删除新 RPC 与新字段即可；skills-CLI 的 lock 文件本就不由 Skill Creator 拥有，回滚不影响用户既有 CLI 工作流。

## Open Questions

- apply-update 刷新 lock 条目时，是直接改写 skills-CLI 的 `.skill-lock.json`（侵入第三方文件），还是只在 Skill Creator 内存里维护「已知最新 hash」覆盖层？当前设计倾向后者（不写第三方文件），但需确认：若不写回，用户下次纯用 CLI 时仍会被 CLI 视作过时。
- `subagents` 字段（v1 项目锁）是否需要在 update-check 时一并 diff？目前列为 Non-Goal，等收到用户反馈再定。
