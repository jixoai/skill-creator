# Tasks: skill-steward-contracts

依赖：已归档的 `manager-core`、`manager-workbench`、`skill-intelligence`；现有 `agent-steward` 代码只能作为迁移素材。此 change 只建立领域契约，不接入 runtime 或生产 UI。

- [ ] 1.1 将 `artifacts/dsh-webui-audit.md` 的官方源码证据纳入实现约束，并在代码注释中标明本阶段不依赖 DSH。
  - Files: `openspec/changes/skill-steward-contracts/artifacts/dsh-webui-audit.md`, relevant source headers.
  - Acceptance: official commit/package/version/seam facts are cited; no claim of DSH integration.
- [ ] 1.2 定义 `SkillStewardContextSnapshot`、`SkillStewardTask`、`SkillStewardResponse`、`SkillToolCall` 和 `SkillPatch` 的 Zod contracts。
  - Files: `src/shared/contracts/skill-steward.ts`，按现有直接 import 模式导出，不为此新建通用 barrel。
  - Acceptance: scope, observed revisions, bounded content, prompt/tool version and capabilities are mandatory and runtime parsed.
- [ ] 1.3 为 finding、edit/disable/split/merge patch、validation result、approval token、audit record 定义闭合 union。
  - Files: same contract module and contract tests.
  - Acceptance: unknown action, missing evidence/revision/version, unsafe destination and mismatched identity are rejected without mutation.
- [ ] 1.4 编写版本化专属 system prompt 与 check/optimize/organize 模板。
  - Files: `src/daemon/steward/prompts.ts`, `src/daemon/steward/templates.ts`.
  - Acceptance: templates declare domain-tool allowlist, evidence format, approval boundary and no-direct-write rule; versions are stable strings.
- [ ] 1.5 增加 contracts fixture 与 focused tests。
  - Files: `test/skill-steward-contracts.test.ts`, `test/fixtures/steward/*.json`.
  - Acceptance: valid payloads round-trip; malformed, stale and path-traversal payloads produce typed failures.
- [ ] 1.6 运行完整门禁并保存明确终态：`pnpm test`、`pnpm typecheck`、`pnpm --dir webui check`、`pnpm build`、`pnpm exec vp fmt --check`、`git diff --check`、`openspec validate --all --strict`。
- [ ] 1.7 为每种 action 提供正反各一份完整 JSON fixture。
  - Files: `test/fixtures/steward/`，说明见 `../skill-steward-runtime/transaction-contract.md`。
  - Evidence: 前后身份、evidence、revision、resource mapping、源技能禁用语义一致；Global 分析/disable 可用，Global edit/split/merge 明确拒绝；kind 与 payload.kind 不一致拒绝。路径负例仅改变合法 fixture 的路径，不同时删 frontmatter/body。

## Review gate

完成后只能宣称“Skill Steward contracts ready”。在后续 runtime change 完成前，不得宣称 DSH 已接入，也不得把旧 ACP transcript 或截图作为产品证据。
