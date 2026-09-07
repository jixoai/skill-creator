# Skill Steward 端到端验收（4.6）

生成：2026-09-07，`pnpm exec tsx scripts/steward-acceptance.sh.ts`（连续两次 exit 0）。
原始证据（含全部 id 与前后文件树）：`steward-acceptance.json`。环境：真实
`bootDaemon` + 官方 DSH host mounted（149 entries）+ `dsh-session-binder` 生产接线；
headless tray（原生窗口路径由 dsh-webui-composition 4.1 证据持有）。

## 任务 × action 矩阵（全部经 run→validate→approve→apply→rollback 真实链路）

| Case             | 任务                  | action    | DSH session | rollback 形态                        | Provider 树断言                                                                                         |
| ---------------- | --------------------- | --------- | ----------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| check-single     | check（单 skill）     | —（只读） | session-1   | —                                    | 0 提案；toolCalls=2                                                                                     |
| check-multi      | check（3 skill 关系） | —（只读） | session-2   | —                                    | stream 帧含 `skills.list_context` + `skills.relations`                                                  |
| optimize-edit    | optimize              | edit      | session-3   | reverse-proposal（独立审批后 apply） | 树逐字节恢复                                                                                            |
| organize-disable | organize              | disable   | session-4   | reverse-proposal（reverse enable）   | `.SKILL.md` 出现→恢复                                                                                   |
| organize-split   | organize              | split     | session-5   | grant-replay（journal 反向重放）     | `-plan/`+`-exec/` 目录+源禁用→恢复                                                                      |
| organize-merge   | organize              | merge     | session-6   | grant-replay                         | 合并目录 `deploy-api-and-deploy-web/`（SKILL.md + 双源资产 copy）+ 双源 `.SKILL.md` 禁用、目录保留→恢复 |

每个 case 记录：`snapshotId`、`dshSessionId`、toolCalls、`proposalId`、validation
（逐项 checks 计数）、`grantId`（fingerprint 前 16 位在 JSON）、`auditId`、apply
`outcomeStatus`、rollback 形态与终态、apply 后与回滚后的完整 Provider 文件树。

## 故障矩阵

- **malformed**：terminal `failed`、0 提案（registry 拒绝且无 draft）。
- **approval-replay**：同一提案第二次 `approve` 被类型化拒绝（apply 后 revision
  推进，validation 变 stale——一次性 grant 语义生效）。
- **stale conflict**：4.4 发布 smoke 已覆盖（外部编辑 → `validate=stale` + approve
  类型化拒绝），证据在 `steward-smoke.json`。
- **disconnect/cancel/late-event**：runtime 既有 focused 测试持有
  （`test/skill-steward-runtime.test.ts` 72/72，含本轮新增 organize-disable /
  organize-merge 场景回归）。

## 真实模型（live）——blocker 记录（按验收条款，不冒充通过）

本机无任何 provider 凭据：`dsh.settings.update({preset:"live"})` 返回类型化
`rejected PRESET_REQUIRES_CREDENTIAL`（detail：当前模型 provider
`steward-deterministic` 无存储凭据）。完成 live 链路需要：先在 runtime config
切换到真实 provider 模型并写入其 API key。deterministic 全链（分析→方案→批准→
apply→rollback，四类 action）已由上表覆盖；live 至少一次全链的补验归发布前
凭据就绪时执行，blocker 证据已入 `steward-acceptance.json`。

## 门禁

`pnpm test` 462+2=464/464（55 files，含新增 2 场景回归）；typecheck 0；webui check
0/0；build；`vp fmt --check` clean；`git diff --check` clean；openspec 9/9。
