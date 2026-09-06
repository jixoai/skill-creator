# skill-steward-contracts verification

记录日期：2026-09-06。提交边界 `5ff7d8f...`（本 change 全部实现提交见下）。运行环境：本仓 dev 主分支，macOS arm64。

## 责任矩阵

| Task | 实现提交 | 证据 |
| --- | --- | --- |
| 1.1 审计证据纳入 + 无 DSH 依赖声明 | d18c148 | `src/shared/contracts/skill-steward.ts` 头注释引用官方 deepseek-harness d347e703 / 0.1.3-alpha.1 与 dsh-* seam 表，并声明本阶段零 DSH import（`rg -n "deepseek-ai" src/shared/contracts/skill-steward.ts` 可见引用仅在注释） |
| 1.2 snapshot/task/response/toolcall/patch 契约 | d18c148 | 同文件：`SkillStewardContextSnapshotSchema`（scope/身份/revision/有界内容/版本/能力，superRefine 预算与成员检查）、`SkillStewardTaskSchema`（check/optimize/organize）、`SkillStewardResponseSchema`（闭合 union）、`SkillToolCallSchema`（七工具 + principal 规则）、`SkillPatchSchema`（edit/disable/split/merge） |
| 1.3 闭合 union 与拒绝语义 | d18c148 | patch/finding/`SkillValidationResultSchema`/`StewardApprovalGrantSchema`/`StewardAuditRecordSchema`；`bindProposalToSnapshot` 输出类型化失败（SNAPSHOT_MISMATCH/UNKNOWN_SKILL/STALE_REVISION/UNSUPPORTED_WRITE_SCOPE/CONTRACT_VERSION） |
| 1.4 版本化 prompt 与模板 | c2871c3 | `src/daemon/steward/prompts.ts`（STEWARD_PROMPT_VERSION/STEWARD_TOOL_VERSION 1.0.0，固定 allowlist/证据格式/审批边界/no-direct-write）+ `templates.ts`（三类任务 user turn + 快照摘要） |
| 1.5 fixtures 与 focused tests | e95f839 | `test/fixtures/steward/*.json` ×10 + `test/skill-steward-contracts.test.ts` 18 tests |
| 1.6 全量门禁 | 本文件 | 见下方命令记录 |
| 1.7 每种 action 正反 fixture | e95f839 | edit(disable-mismatch)/disable(missing-evidence)/split(traversal)/merge(traversal traversal)；负例单变量变更，frontmatter/body 完整保留 |

## 门禁记录（串行执行，2026-09-06）

```text
pnpm test                      -> 271/271 passed（40 files，80.66s；含 18 项新契约测试）
pnpm typecheck                 -> 0 错误
pnpm --dir webui check         -> 0 errors, 0 warnings
pnpm build                     -> 成功；webui staged → dist/webui（5 entries）
pnpm exec vp fmt --check       -> 全绿
git diff --check               -> 干净
openspec validate --all --strict -> 9 passed, 0 failed
```

## 前置修复（GOAL Observe 要求的 2 项 timeout）

- 根因：每个测试用 daemon domain 首次 `skills.list` 触发真实 `npx skills list --json` 子进程（15s 超时、可访问网络）；高负载下单用例超过 vitest 20s 用例超时（reviewer 复现 417s / 2 timeouts）。
- 修复：`createDaemonDomain` 支持注入 `skillsCliProbe`；六个测试文件改用 `test/helpers/deterministic-probe.ts`（零子进程、零网络）。提交 9aca0fc。
- 结果：`pnpm exec vitest run test/agent-steward.test.ts` 16 tests ~4s（原 ~120s 本机 / 417s 负载）；全量 253→271 全绿。未提高任何 timeout，未删除测试。

## 未验证项（诚实声明）

- 本 change 仅契约层：未接入任何 Agent runtime（DSH/Codex）、无 WebUI、无 daemon RPC 暴露。按 tasks.md Review gate，只能宣称 "Skill Steward contracts ready"。
- `demo/contracts-reference.html` 未作为任何实现依据（`rg -rn "contracts-reference" src webui/src test` 零引用）。
