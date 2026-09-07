# skill-steward-runtime verification

记录日期：2026-09-06。实现提交：4d7d1f7（2.1 tool registry）、423345f（2.2 fixture runtime + transcript）、66cb7ed（2.3a snapshot + audit store）、89b6c03（2.3b/2.3c/2.3d 审批/事务/回滚，含契约 1.1.0 enable）、5781109（2.3f RPC 串联）、20ec083（2.3e 恢复扫描 + 真实 Provider 加固）、a81815f（journal 故障零写入）。前置：9aca0fc（2.4b timeout 根因）。

## 门禁（task 2.5，串行）

```text
pnpm test                        -> 303/303 passed（41 files；含 skill-steward-runtime 32 项 + contracts 18 项）
pnpm typecheck                   -> 0 错误
pnpm --dir webui check           -> 0 errors, 0 warnings
pnpm build                       -> 成功；webui staged 5 entries
pnpm exec vp fmt --check         -> 全绿
git diff --check                 -> 干净
openspec validate --all --strict -> 9 passed, 0 failed
```

## 任务证据矩阵

| Task                                      | 状态 | 证据                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 tool registry + capability            | ✓    | `tool-registry.ts` 七工具闭合、非域工具 denied+审计、agent 禁 apply/rollback、proposal 全契约+bind 校验；6 测试                                                                                                                                                                                                        |
| 2.2 fixture adapter + transcript          | ✓    | `fixture-agent.ts` 9 场景 + `runtime.ts` 终态/迟到事件边界；`artifacts/fixture-transcript.json`（valid-check/late-event 双跑逐字节一致）；测试断言 JSON 相等                                                                                                                                                           |
| 2.3a snapshot + audit store               | ✓    | 单遍读取（快照后改 Provider 字节不变）、预算超限 typed 拒绝、资源清单 hash、重启读回；audit store 重启 round-trip                                                                                                                                                                                                      |
| 2.3b validate/approve/apply/rollback 分离 | ✓    | validation 零授权；grant 一次性（重放拒绝、重启失效）；fingerprint 复核；并发 apply 单执行（applying 锁）；agent apply denied；旧 `skillIntelligence.approve` 对 Steward proposal 只会 NOT_FOUND 零 mutation（测试覆盖）。该旧面是 manager-workbench 既有 human-UI surface（独立命名空间，Agent tool registry 不可达） |
| 2.3c edit/disable journal + 补偿          | ✓    | 逐字节恢复（edit rollback）；中途失败补偿恢复第一步原字节；journal 持久化失败 → compensated 且零写入                                                                                                                                                                                                                   |
| 2.3d split/merge + 资源映射               | ✓    | 资源 copy 落盘 + 源禁用目录保留；目标名冲突 validate 即拒（零写入）；journal replay rollback 恢复完整树与启停                                                                                                                                                                                                          |
| 2.3e crash/restart recovery fixtures      | ◐    | `scanUnfinishedJournals` 扫描崩溃残留（不重放写）+ 测试；「封锁目标写入」的恢复闸门尚未接入 apply 入口（见未验证项）                                                                                                                                                                                                   |
| 2.3f 串联 + RPC                           | ✓    | `skillSteward` RPC 六端点；e2e 测试 check→optimize→validate→approve→apply→byte-rollback 全链；malformed 终态零提案                                                                                                                                                                                                     |
| 2.4a cancel/start/dispose 并发            | ✓    | 新 runtime：cancel signal 有界、applying 并发锁、迟到事件丢弃已测。残余收口（DSH 阶段 owner，2026-09-07）：`dsh-agent-runtime.ts` `awaitIdleBounded`（deadline→cancel→grace→强制释放；record.forcedRelease）+ session `dispose()`（清理失败进 record.cleanupErrors，修正原 finally 死代码）；挂起 adapter 负例 15/15   |
| 2.4 安全与生命周期 focused tests          | ✓    | stale/replayed approval/Global target/path traversal/cancel/daemon dispose 均有 typed 终态断言；新管线无临时 execution root（快照即上下文，无孤儿目录风险）                                                                                                                                                            |
| 2.4b timeout 归因                         | ✓    | 根因 npx probe（见 contracts verification）；`pnpm exec vitest run test/agent-steward.test.ts` 连续两次 16/16（6.58s / 5.26s）；全量 303/303                                                                                                                                                                           |

## 未验证项（诚实声明）

- 2.3e 的恢复闸门：`scanUnfinishedJournals` 已能发现残留，但 apply 入口尚未在启动时强制「先扫描再开放写入」；真实进程 kill 注入（每个写边界）未执行。下一阶段接线。
- 2.4a 的 adapter 强制释放 deadline 属于 DSH adapter 阶段的验收形态。（已收口：见 2.4a 行——awaitIdleBounded + dispose 可见化，test/dsh-runtime-integration.test.ts 挂起 adapter 负例。）
- 本阶段 backend 锁定 fixture；DSH/Codex runtime、WebUI 未接入（Non-Goal）。
- 契约演进 1.0.0→1.1.0（enable patch）：阶段 1 的 Codex 复核仍针对 1.0.0 边界，结论出来后需要按 findings 决定是否补一轮契约复核。

## 责任矩阵

实现与测试：ZCode（GLM-5.3）。fixture transcript 生成脚本化（`bun -e` 一次性脚本，产物已入库）。阶段 2 独立 Codex 复核按 GOAL Review Loop 排程。

## 2.3e 增量（2026-09-07，R13 P2 owner 落地）

- 新 `src/daemon/steward/store-anchor.ts`：Manager 事实目录（journal 目录 / backup root）的进程生命周期 inode 锚——首见锚定（canonical 通过后记录 {dev,ino}）、跨调用复验（换体 → `UNAVAILABLE: replaced during this daemon lifetime`）；`resetStoreAnchors()` 建模 daemon 重启（重启前换体成为新真相，属人工恢复决策面——已在模块头声明）。接线点：`prepareBackupRoot`（先 mkdir 再锚定 journal 目录与 backup root）、journal writer（open 前锚定）、`readJournal`（读取前锚定）。
- `readBackupManifest` 手工字段 parser 替换为 strict Zod `BackupManifestLineSchema`（journal-schema 导出）：未知字段、`..` 穿越 from、坏 sha256、负 byteSize 全部拒绝（附 64MB 上限）。
- 负例（`test/r8-independent-probes.test.ts` [2.3e] ×4）：跨调用 backup root 换体 → 读写均拒绝且替换目录零字节；journal 目录换体 → 不再是事实源；resetStoreAnchors → 重启等价重锚；manifest 未知字段/穿越/坏 hash/坏 size 四类拒绝。
- 门禁：contracts 42/42、runtime 66/66、probes 18/18、全量 434/434（52 files）、typecheck 0、webui 0/0、fmt 全树、openspec 9/9。
- 未验证项更新：2.3e 的「不完整恢复封锁目标写入」（apply 入口闸）仍开放；boot 显式接线目前由首见锚定承载（store 初始化路径未显式调用——首见即 daemon 生命周期内第一次使用，语义等价）。

## 2.3e 收尾：apply 入口恢复闸（本提交）

- `scanUnfinishedJournals` 语义修正：终态 commit 行 = 事务已完成（不再上报，绝不阻塞后续 apply）；只上报无 commit 行的残留与损坏 journal。
- `approval-service.apply` 前置恢复闸：扫描未完成 journal——同 target 残留（含自身重复 apply 的残留）封锁该 target 写入；proposal 不可解析的重启残留（target 未知）保守封锁全部 apply；不同 target 的已知残留不互相干扰。拒绝信息逐项诊断（id/步数/末步/损坏态）。
- 负例 ×3：真实 apply→剥离 commit 行→新快照 disable 提交→apply 被封锁且诊断含残留 id；committed journal 不阻塞（正向：第一次 apply 后同 target 第二个 proposal 正常 applied）；预置不可解析重启残留→任何 apply 被保守封锁。
- 门禁：contracts 42/42、runtime 69/69、probes 18/18、全量 437/437（52 files）、typecheck 0、webui 0/0、fmt 全树、openspec 9/9。
- 2.3e 三项验收对照：journal 不丢（append fd + 逐行 fsync + O_EXCL + inode 锚）✓；重启不重放 grant（invalidateUnconsumedGrants）✓；不完整恢复封锁目标写入 + 逐项诊断（本闸）✓。
