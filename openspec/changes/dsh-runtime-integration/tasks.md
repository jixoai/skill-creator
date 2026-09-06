# Tasks: dsh-runtime-integration

依赖：`skill-steward-runtime`。源码证据见 `docs/research/2026-09-06-dsh-integration.md`。本阶段只实现 runtime/config service；下阶段 `dsh-webui-composition` 独占浏览器插件任务，不循环依赖。

- [x] 3.1 建立 DSH adapter handshake，锁定官方 commit/version、composition rows 与 capability matrix。
  - Files: `src/daemon/steward/dsh-adapter.ts`, `src/shared/contracts/dsh-runtime.ts`.
  - Acceptance: missing packages, version mismatch and missing plugin rows return typed unavailable; no implicit fallback. 使用实际 package composition，不要求另装 dsh-acp 可执行文件。
  - Evidence: db13aa8 —— @deepseek-ai/* 五包精确锁定 0.1.2-rc.1（devDependencies），审计 commit d347e703 写入契约；handshake 真实 require 逐包校验版本与组合行导出（AgentRegistry/AgentLoop/ToolRuntime/SystemPrompt/SessionStore），能力矩阵由已解析 rows 派生；注入式负例覆盖 MISSING_PACKAGE/VERSION_MISMATCH/COMPOSITION_ROW_MISSING（`pnpm exec vitest run test/dsh-runtime-integration.test.ts` 4 passed）；旧 dsh-acp backend 及其测试已移除。
- [ ] 3.2 适配 DSH agent/session/stream/tool callback。
  - Files: `src/daemon/steward/dsh-adapter.ts`, `src/daemon/steward/dsh-events.ts`.
  - Steps: 通过实际 DSH tools.register 接入阶段 2 的七个领域工具，restriction 仅允许该白名单；注册版本化 prompt sections；所有执行回到 Manager，不注册通用文件或 shell 工具。外部响应和通知先以 `unknown` 解析并经 schema/narrowing 收窄，不使用未经验证的对象断言。
  - Acceptance: promptVersion/toolVersion/snapshot id are recorded; every domain tool call returns to Manager registry; cancellation drains child/session resources；未知帧、未知 tool request、错误 capability declaration 均 fail closed。
- [ ] 3.3 适配 model/preset/permission/session controls 与 DSH client stream projection。
  - Files: `src/shared/contracts/dsh-runtime.ts`, `src/daemon/steward/dsh-settings.ts`, `src/shared/rpc-contract.ts`.
  - Acceptance: runtime settings/config revision and session streams are available to the later DSH client plugin; credentials are redacted from run/audit payloads. No browser component is required in this phase.
- [ ] 3.4 建立 DSH unavailable/recovery tests and a de-identified transcript。
  - Files: `test/dsh-runtime-integration.test.ts`, `openspec/changes/dsh-runtime-integration/artifacts/dsh-transcript.json`.
  - Acceptance: 使用真实锁定 DSH packages + deterministic LLM adapter 跑 tool round/cancel/replay；另测 missing packages、invalid config、permission-denied。只有 unavailable 证据时本任务保持未完成；真实模型 smoke 由最终产品阶段验收。
- [ ] 3.5 运行 focused tests and `pnpm typecheck`, `pnpm build`, `openspec validate --all --strict`。
