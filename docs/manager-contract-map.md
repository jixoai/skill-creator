<!--
用户原始需求 [2026-09-05]：「Manager 永远拥有路径、文件、revision、启停、安装、更新、draft、approval 和 audit authority。」
正交意图：
  [1] 逐项列出 Manager RPC procedure 的输入、输出、authority 与错误词汇（事实源：src/shared/rpc-contract.ts + src/daemon/rpc-router.ts）。
  [2] 以 ASCII 数据流固化「WebUI 不拼路径、server 解析 opaque ID」的边界例子。
  [3] 记录每个 procedure 的 focused test 归属，作为验收与回归的索引。
妥协声明：本文档是代码事实的投影，代码变更时必须同步更新；不承载实现。
-->

# Manager Contract Map

事实源：`src/shared/rpc-contract.ts`（契约组合）、`src/daemon/rpc-router.ts`（handler 绑定）、
`src/daemon/domain.ts`（模块组合）。错误词汇：`src/shared/contracts/errors.ts` 的
`NOT_FOUND(404)` / `CONFLICT(409)` / `INVALID_OPERATION(422)` / `UNAVAILABLE(503)`；
仅 `DomainError` 在 router 根 middleware 转换为 oRPC 错误，未知基础设施失败原样抛出。

## Procedure 一览

Authority 列说明谁拥有真相：`registry` = Workspace Registry 单例（持久化 workspaces.json）；
`fs` = server-owned 文件系统写入（canonical root 派生）；`session` = daemon 内存会话；
`proc` = daemon 子进程；`status` = daemon 运行时状态函数。

### skills.\*

| Procedure             | 输入                                            | 输出                                                                 | Authority                                         | 主要错误                                                   | Focused tests                                                   |
| --------------------- | ----------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `skills.list`         | `{ workspaceId, providerId, includeDisabled? }` | `{ skills: SkillMetadata[] }`                                        | registry → Provider root 扫描（ccski）            | 未知 target → `NOT_FOUND`；root 不可达 → `UNAVAILABLE`     | `test/skill-service.test.ts`, `test/workspace-registry.test.ts` |
| `skills.info`         | target + `skillId`                              | `SkillInfo`（含文档）                                                | registry → containment                            | `NOT_FOUND`                                                | `test/skill-service.test.ts`                                    |
| `skills.toggle`       | target + `skillIds[]` + `mode`                  | `ToggleSummary`（enabled/disabled/conflicts）                        | fs（启停标记）                                    | 目标态冲突 → `CONFLICT`                                    | `test/skill-service.test.ts`                                    |
| `skills.validate`     | target + `skillId`                              | `ValidateResult`                                                     | 只读校验（ccski）                                 | `NOT_FOUND`                                                | `test/skill-service.test.ts`                                    |
| `skills.update.check` | target + `skillIds[]`                           | `UpdateCheckResult`（逐项 outdated/skipped/failed + lock hash 对比） | 只读；读 skills-CLI lock（safeParse 失败 → null） | lock 缺失 → 逐项 skipped，不抛错                           | `test/skills-cli-compat.test.ts`                                |
| `skills.update.apply` | target + `skillIds[]`                           | `ApplyUpdateResult`（逐项重装结果）                                  | fs（复用 repository install 流水线重装）          | 上游缺失 → 逐项 failed；session 失效 → `INVALID_OPERATION` | `test/skills-cli-compat.test.ts`                                |

### workspace.\*

| Procedure             | 输入                          | 输出                                                      | Authority                                            | 主要错误                                        | Focused tests                     |
| --------------------- | ----------------------------- | --------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- | --------------------------------- |
| `workspace.list`      | `{}`                          | `{ workspaces: Workspace[] }`（含动态 Provider 计数投影） | registry（只读投影，不写回）                         | —                                               | `test/workspace-registry.test.ts` |
| `workspace.add`       | `{ path, label? }`            | `{ workspace }`                                           | registry（realpath + digest → 原子持久化后替换内存） | 路径非法/不是目录 → `INVALID_OPERATION`         | `test/workspace-registry.test.ts` |
| `workspace.remove`    | `{ id: ImportedWorkspaceId }` | `{ activeId }`                                            | registry（只删注册表项，不删目录）                   | `~` 或未知 ID → `INVALID_OPERATION`/`NOT_FOUND` | `test/workspace-registry.test.ts` |
| `workspace.setActive` | `{ id }`                      | `{ activeId }`                                            | registry                                             | 未知 ID → `NOT_FOUND`                           | `test/workspace-registry.test.ts` |

### creator.\*

| Procedure           | 输入                                                           | 输出                                        | Authority                                          | 主要错误                                                                                                     | Focused tests                                             |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `creator.save`      | `SaveSkillInput`（create 与 revision-checked update 的 union） | `SaveSkillResult`（含新 revision）          | fs（Provider root direct child + 临时文件 rename） | 非法目录名/逃逸 → `INVALID_OPERATION`；stale revision → `CONFLICT`；frontmatter 不兼容 → `INVALID_OPERATION` | `test/creator-service.test.ts`, `test/rpc-errors.test.ts` |
| `creator.load`      | target + `skillId`                                             | `SkillDocument`                             | 只读（gray-matter round-trip 基线）                | `NOT_FOUND`；不兼容 frontmatter → `INVALID_OPERATION`                                                        | `test/creator-service.test.ts`                            |
| `creator.remove`    | target + `skillId` + `expectedRevision`                        | `{ removed: true }`                         | fs（revision 校验后删除）                          | stale revision → `CONFLICT`；跨 Workspace 边界 → `NOT_FOUND`/`INVALID_OPERATION`                             | `test/creator-service.test.ts`                            |
| `creator.revisions` | target + `skillId`                                             | `CreatorRevisionsResult`（change log 条目） | 只读（同目录 revision 历史快照）                   | `NOT_FOUND`                                                                                                  | `test/creator-service.test.ts`                            |

### repository.\*

| Procedure                   | 输入                                                         | 输出                                                                                           | Authority                                                    | 主要错误                                                                         | Focused tests                                                         |
| --------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `repository.scan`           | `{ source, ref? }`                                           | `RemoteRepoScan`（pinned commit + remote skills）                                              | session（shallow clone → `git rev-parse HEAD` 固定）         | clone 失败 → `UNAVAILABLE`（不泄漏 Git 诊断）；非法 commit → `INVALID_OPERATION` | `test/repository-lifecycle.test.ts`, `test/rpc-errors.test.ts`        |
| `repository.preview`        | `{ sessionId, skillId }`                                     | `RemoteSkillPreview`                                                                           | session（同一 pinned clone）                                 | session 缺失/被淘汰 → `INVALID_OPERATION`                                        | `test/repository-lifecycle.test.ts`                                   |
| `repository.install`        | `RepositoryInstallInput`（session + selected ids + targets） | `InstallSummary`（逐项 installed/overwritten/skipped/failed + ExpectedInstallTarget 全链验证） | fs（Provider root direct child；ccski output runtime parse） | 见 `AGENTS.md` §3.4：逐项失败不抹前项                                            | `test/repository-lifecycle.test.ts`                                   |
| `repository.sources.list`   | `{}`                                                         | `{ builtIn[], user[] }`                                                                        | fs（appDir/sources.json，server-owned）                      | —                                                                                | `test/source-registry.test.ts`, `test/repository-sources-rpc.test.ts` |
| `repository.sources.add`    | `{ gitUrl, label }`                                          | `{ source }`                                                                                   | fs（仅 https、去重、`user_` 前缀隔离）                       | 非 https/重复 → `INVALID_OPERATION`                                              | `test/repository-sources-rpc.test.ts`                                 |
| `repository.sources.remove` | `{ id }`                                                     | `{ removed: true }`                                                                            | fs（内置 id 拒绝删除）                                       | 内置 id → `INVALID_OPERATION`                                                    | `test/repository-sources-rpc.test.ts`                                 |

### daemon._ / acp._

| Procedure           | 输入                                   | 输出                                                | Authority                              | 主要错误                                              | Focused tests                |
| ------------------- | -------------------------------------- | --------------------------------------------------- | -------------------------------------- | ----------------------------------------------------- | ---------------------------- |
| `daemon.status`     | `{}`                                   | `DaemonStatus`（tray capability 终态）              | status（daemon 运行时）                | —                                                     | `test/cli-lifecycle.test.ts` |
| `acp.agents.list`   | `{}`                                   | `{ agents: AcpAgentInfo[] }`                        | proc（PATH 探测，daemon 生命周期缓存） | —                                                     | `test/acp-bridge.test.ts`    |
| `acp.session.open`  | `{ agentId, workspaceId, providerId }` | `AcpSessionOpenResult`（opaque sessionId + WS URL） | proc（spawn at Provider root）         | 二进制缺失 → `UNAVAILABLE`；未知 target → `NOT_FOUND` | `test/acp-bridge.test.ts`    |
| `acp.session.close` | `{ sessionId }`                        | `{ closed: true }`                                  | proc（有界杀进程，幂等）               | 未知 session → 幂等成功                               | `test/acp-bridge.test.ts`    |

ACP 安全门：agent 的 `fs/read_text_file`、`fs/write_text_file` 请求由 daemon 代为执行
（containment + 原子写），agent 永不获得原始文件句柄；覆盖测试在 `test/acp-bridge.test.ts`。

## 数据流与路径边界

```text
WebUI (browser)
  |
  |  oRPC over WS: 只传 opaque ID { workspaceId, providerId, skillId, sessionId, ... }
  v
rpc-router (src/daemon/rpc-router.ts)
  |
  |  DomainError -> RpcErrorDefinitions 一次性转换（根 middleware）
  v
domain modules (src/daemon/domain.ts)
  |
  |  registry.resolveScope(workspaceId, providerId)
  |      -> { allowedRoot }        # 唯一真相：canonical Provider root
  v
server-owned path derivation (src/daemon/path-safety.ts)
  |
  |  skillId -> registry/canonical skill path digest 校验
  |  directoryName -> lowercase safe name + direct-child containment
  |  install output -> Provider root direct child + SKILL.md lstat regular
  v
Filesystem (mutation)
```

### 「不允许 WebUI 拼路径」的具体例子

```text
[禁止] WebUI: save({ path: "../../.ssh/x/SKILL.md", ... })
         └── 永远不可能发生：SaveSkillInput 不含 path 字段，只有 directoryName，
             且 daemon 强制 lowercase safe name + Provider root direct child。

[禁止] WebUI: install({ dest: "/etc/skills", ... })
         └── 永远不可能发生：install 输入只有 opaque sessionId + selected remote ids +
             Workspace Provider Target；目标 root 由 registry 解析，
             installer output 还要过 ExpectedInstallTarget 全链匹配。

[允许] WebUI: creator.save({
              target: { workspaceId: "ws_ab12", providerId: "claude-code" },
              directoryName: "pdf-tools",
              ...
            })
         └── daemon: resolveScope -> /Users/x/.claude/skills (canonical)
                     -> /Users/x/.claude/skills/pdf-tools/SKILL.md
                     -> 同目录临时文件 + rename 原子写
```

外部输入 runtime 收窄清单（safeParse / parser，全部先 `unknown`）：

| 输入                     | Parser                 | 失败投影                                       |
| ------------------------ | ---------------------- | ---------------------------------------------- |
| `workspaces.json`        | v2 schema `safeParse`  | 空 Registry（不迁移不写回）                    |
| `sources.json`           | schema `safeParse`     | 空用户源列表                                   |
| ccski 发现/校验输出      | 逐条 `safeParse`       | 丢弃该条 / failed validation                   |
| Git `rev-parse` 输出     | commit identity parser | 删除 unretained snapshot + `INVALID_OPERATION` |
| `SKILL.md` frontmatter   | gray-matter + Zod      | invalid-document 类型化拒绝                    |
| skills-CLI lock (v3/v1)  | schema `safeParse`     | `null`（skipped，不抛错）                      |
| `npx skills list --json` | JSON parse + schema    | 空 map                                         |
| installer/ccski 安装输出 | 逐项 runtime parse     | identity-free `failed`                         |
| IPC/WS 帧                | frame + Zod            | 类型化错误，帧上限保护                         |
