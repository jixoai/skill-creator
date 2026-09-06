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

| Task | 状态 | 证据 |
| --- | --- | --- |
| 2.1 tool registry + capability | ✓ | `tool-registry.ts` 七工具闭合、非域工具 denied+审计、agent 禁 apply/rollback、proposal 全契约+bind 校验；6 测试 |
| 2.2 fixture adapter + transcript | ✓ | `fixture-agent.ts` 9 场景 + `runtime.ts` 终态/迟到事件边界；`artifacts/fixture-transcript.json`（valid-check/late-event 双跑逐字节一致）；测试断言 JSON 相等 |
| 2.3a snapshot + audit store | ✓ | 单遍读取（快照后改 Provider 字节不变）、预算超限 typed 拒绝、资源清单 hash、重启读回；audit store 重启 round-trip |
| 2.3b validate/approve/apply/rollback 分离 | ✓ | validation 零授权；grant 一次性（重放拒绝、重启失效）；fingerprint 复核；并发 apply 单执行（applying 锁）；agent apply denied；旧 `skillIntelligence.approve` 对 Steward proposal 只会 NOT_FOUND 零 mutation（测试覆盖）。该旧面是 manager-workbench 既有 human-UI surface（独立命名空间，Agent tool registry 不可达） |
| 2.3c edit/disable journal + 补偿 | ✓ | 逐字节恢复（edit rollback）；中途失败补偿恢复第一步原字节；journal 持久化失败 → compensated 且零写入 |
| 2.3d split/merge + 资源映射 | ✓ | 资源 copy 落盘 + 源禁用目录保留；目标名冲突 validate 即拒（零写入）；journal replay rollback 恢复完整树与启停 |
| 2.3e crash/restart recovery fixtures | ◐ | `scanUnfinishedJournals` 扫描崩溃残留（不重放写）+ 测试；「封锁目标写入」的恢复闸门尚未接入 apply 入口（见未验证项） |
| 2.3f 串联 + RPC | ✓ | `skillSteward` RPC 六端点；e2e 测试 check→optimize→validate→approve→apply→byte-rollback 全链；malformed 终态零提案 |
| 2.4a cancel/start/dispose 并发 | ◐ | 新 runtime：cancel signal 有界、applying 并发锁、迟到事件丢弃已测；「abort-ignoring adapter 强制 deadline 释放」针对后续 DSH adapter，本阶段 fixture 无此形态 |
| 2.4 安全与生命周期 focused tests | ✓ | stale/replayed approval/Global target/path traversal/cancel/daemon dispose 均有 typed 终态断言；新管线无临时 execution root（快照即上下文，无孤儿目录风险） |
| 2.4b timeout 归因 | ✓ | 根因 npx probe（见 contracts verification）；`pnpm exec vitest run test/agent-steward.test.ts` 连续两次 16/16（6.58s / 5.26s）；全量 303/303 |

## 未验证项（诚实声明）

- 2.3e 的恢复闸门：`scanUnfinishedJournals` 已能发现残留，但 apply 入口尚未在启动时强制「先扫描再开放写入」；真实进程 kill 注入（每个写边界）未执行。下一阶段接线。
- 2.4a 的 adapter 强制释放 deadline 属于 DSH adapter 阶段的验收形态。
- 本阶段 backend 锁定 fixture；DSH/Codex runtime、WebUI 未接入（Non-Goal）。
- 契约演进 1.0.0→1.1.0（enable patch）：阶段 1 的 Codex 复核仍针对 1.0.0 边界，结论出来后需要按 findings 决定是否补一轮契约复核。

## 责任矩阵

实现与测试：ZCode（GLM-5.3）。fixture transcript 生成脚本化（`bun -e` 一次性脚本，产物已入库）。阶段 2 独立 Codex 复核按 GOAL Review Loop 排程。
