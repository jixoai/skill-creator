# Tasks: skill-steward-contracts

依赖：已归档的 `manager-core`、`manager-workbench`、`skill-intelligence`；现有 `agent-steward` 代码只能作为迁移素材。此 change 只建立领域契约，不接入 runtime 或生产 UI。

- [x] 1.1 将 `artifacts/dsh-webui-audit.md` 的官方源码证据纳入实现约束，并在代码注释中标明本阶段不依赖 DSH。
  - Files: `openspec/changes/skill-steward-contracts/artifacts/dsh-webui-audit.md`, relevant source headers.
  - Acceptance: official commit/package/version/seam facts are cited; no claim of DSH integration.
  - Evidence: `src/shared/contracts/skill-steward.ts` 头注释引用官方 deepseek-harness commit d347e703 / 0.1.3-alpha.1 与 dsh-agent/-tools/-system-prompt 等 seam，并声明零 DSH import；`rg "deepseek-ai" src/shared/contracts/skill-steward.ts` 仅注释命中。提交 d18c148。
- [x] 1.2 定义 `SkillStewardContextSnapshot`、`SkillStewardTask`、`SkillStewardResponse`、`SkillToolCall` 和 `SkillPatch` 的 Zod contracts。
  - Files: `src/shared/contracts/skill-steward.ts`，按现有直接 import 模式导出，不为此新建通用 barrel。
  - Acceptance: scope, observed revisions, bounded content, prompt/tool version and capabilities are mandatory and runtime parsed.
  - Evidence: 五个 schema 全部落地；快照 superRefine 强制 100 skills / 256KiB 单技能 / 2MiB 总量预算与成员一致性；revision 用 `sha256:` 前缀约束。18 项契约测试断言 round-trip 与拒绝。提交 d18c148。
- [x] 1.3 为 finding、edit/disable/split/merge patch、validation result、approval token、audit record 定义闭合 union。
  - Files: same contract module and contract tests.
  - Acceptance: unknown action, missing evidence/revision/version, unsafe destination and mismatched identity are rejected without mutation.
  - Evidence: 未知 action / kind-payload 不一致 / 缺 evidence / 穿越 directoryName / 穿越资源 targetPath 均在 safeParse 层拒绝；`bindProposalToSnapshot` 对 stale、unknown skill、snapshot mismatch、contract version、Global 写作用域输出类型化失败。测试见 `test/skill-steward-contracts.test.ts`。提交 d18c148 / e95f839。
- [x] 1.4 编写版本化专属 system prompt 与 check/optimize/organize 模板。
  - Files: `src/daemon/steward/prompts.ts`, `src/daemon/steward/templates.ts`.
  - Acceptance: templates declare domain-tool allowlist, evidence format, approval boundary and no-direct-write rule; versions are stable strings.
  - Evidence: STEWARD_PROMPT_VERSION/STEWARD_TOOL_VERSION = 1.0.0；prompt 固定五工具 allowlist、证据格式、validation-never-authorizes 边界、no-direct-write 与 needs-review 规则；模板渲染三类任务并携带快照摘要与版本头；测试断言各段落存在。提交 c2871c3。
- [x] 1.5 增加 contracts fixture 与 focused tests。
  - Files: `test/skill-steward-contracts.test.ts`, `test/fixtures/steward/*.json`.
  - Acceptance: valid payloads round-trip; malformed, stale and path-traversal payloads produce typed failures.
  - Evidence: 18/18 passed（`pnpm exec vitest run test/skill-steward-contracts.test.ts`，123ms）。提交 e95f839。
- [x] 1.6 运行完整门禁并保存明确终态：`pnpm test`、`pnpm typecheck`、`pnpm --dir webui check`、`pnpm build`、`pnpm exec vp fmt --check`、`git diff --check`、`openspec validate --all --strict`。
  - Evidence: 271/271 tests（40 files）、tsc 0、svelte-check 0/0、build+staged 5 entries、fmt 全绿、diff 干净、openspec 9/9；记录于 `artifacts/verification.md`。前置修复 reviewer 报告的 2 项 timeout（根因 npx probe，提交 9aca0fc，未提 timeout 未删测试）。
- [x] 1.7 为每种 action 提供正反各一份完整 JSON fixture。
  - Files: `test/fixtures/steward/`，说明见 `../skill-steward-runtime/transaction-contract.md`。
  - Evidence: 前后身份、evidence、revision、resource mapping、源技能禁用语义一致（split/merge rationale 明示源目录保留、校验后禁用）；Global 分析/disable 可用、Global edit/split/merge 输出 UNSUPPORTED_WRITE_SCOPE；kind 与 payload.kind 不一致拒绝；路径负例仅改路径（edit 负例仅改 action 字段），frontmatter/body 完整。提交 e95f839。

## Review gate

完成后只能宣称“Skill Steward contracts ready”。在后续 runtime change 完成前，不得宣称 DSH 已接入，也不得把旧 ACP transcript 或截图作为产品证据。
