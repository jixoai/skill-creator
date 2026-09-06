# ZCode Agent Steward Review

日期：2026-09-06。提交边界 `65f937a...ba63b41`；实现提交 `27446f7`，归档提交 `ba63b41`。本轮工作树修改为规划文档，生产代码未变。以下区分实际代码缺陷、用户澄清后的产品差距和我负责的规划错误；新 change 未实现不属于 ZCode 对尚未收到任务的违约。

**结论：4.5/10，不具备当前 AI-SKILLS-MANAGEMENT 目标的上线条件。** 分项：Manager 复用基础 7/10，专属 Agent 能力 2/10，DSH 集成 1/10，交付证据 4/10。综合分是审查判断，不是测试覆盖率。

## Spec Axis

1. **P1 用户要求的 harness 开发基础未交付。** `src/daemon/steward/dsh-adapter.ts:42` 默认 dsh-acp，`:201`/`:214` 发送 session/new、session/prompt。官方 DSH 确实有 ACP profile；问题不是 ACP 不存在，而是当前接法没有注册专属 tools/prompts，也没有复用 DSH Web settings/session/chat 插件。旧 task 1.5 本来就要求 ACP，这个方向性错误主要由我承担。
2. **P1 模型输出仍是文本解析。** `src/daemon/steward-service.ts:90` 截取首尾方括号；`:445` 将 finalMessage 转成 recommendations。`harness-adapter.ts:94` 只有 handshake/run/dispose，没有领域工具调用面。check/optimize/organize 专属模板及其版本未实现。
3. **P1 分析依据与 apply revision 脱节。** `steward-service.ts:324` 先分析，`:330` 再读文档复制，`:466` propose；`skill-intelligence-service.ts:117`/`:134` 再读当前 revision。运行中修改文件时，Agent 依据 A 得出的草稿可能被绑定为 C 版本，不符合不可变快照。proposal payload 也没有在 run 边界验证所有身份属于其选定范围。
4. **P1 approve 并发可能重复进入 mutation。** `steward-service.ts:608` 检查 decidedProposals，`:611` await intelligence.approve 后才 add。两个并发请求可同时越过检查。没有独立 grant/fingerprint、持久 journal 或 inverse rollback；`rpc-contract.ts:209` 无 rollback。split/merge 在 `skill-intelligence-service.ts:300` 起逐项创建/删除，失败可能留下部分状态，资源映射也不完整。
5. **P1 旧 direct approve 仍是潜在授权旁路。** `rpc-contract.ts:207` 与 `rpc-router.ts:126` 继续暴露 `skillIntelligence.approve`，它直接调用 `domain.skillIntelligence.approve`；当前没有 Steward grant/fingerprint 或调用方身份边界。新 Steward 事务必须删除该旁路，或把它拆成明确的 human-only legacy contract 并复用同一授权服务。
6. **P1 DSH UI 合并和维护流程缺失。** `workspaces/StewardView.svelte:135` 只能默认目标启动；`:398` 后没有 task/skill selection、完整 diff/evidence/validation/rollback。manifest 中作为子 activity 本身不是 bug；真正缺失是专属工作流与 DSH Agent 控件。CreatorWorkspace 仍挂 ACP 面板，不能代替目标。
7. **P2 审计与恢复未达产品要求。** `steward-service.ts:125` 仅内存 runs/events；StewardRun 不保存 findings/content/promptVersion/toolVersion。`:258` resolveWritable 把 Global 只读分析一并拒绝。`RecommendationSchema` 允许空 findingIds，kind 与 payload.kind 无一致性约束。

## Standards Axis

1. **P1 capability 不反映真实权限行为。** DSH `dsh-adapter.ts:147` 声明 permissionRequests:true，但仅有 onNotification；Codex `codex-adapter.ts:205` 拒绝全部 server approval，却也声明支持。需要实际 handler 测试支撑可用能力，不能硬编码 true。
2. **P1 生命周期缺少强制终止边界。** `steward-service.ts:540` cancel 等待 pipeline，`:662` dispose 等待 adapters 和 pipelines；不响应 abort 的 adapter 可阻塞退出。`:165` 忽略 cleanup 错误。start 在 handshake 后也未复查 disposed，stop 与 start 并发有迟到建 run 风险。
3. **P2 终态继续轮询且丢错误。** `StewardView.svelte:103` status 被 untrack，两分支相同，始终启动 interval；`:118` 静默丢失败。切 route/run 时需要组件自己的 owner gate，而非仅共享模块最新请求门。
4. **P2 类型和文档表达欠清晰。** `StewardView.svelte:140`、`:194`、`:212` 用 as never 绕过品牌类型；README 仍强调 Creator ACP。router/domain 意图头未包含新 Steward 职责。文件正交意图数量属于需要重新分组核对的设计判断，不能简单把每个 RPC namespace 算成独立意图后判阻塞。

## Verification

同一源码审查期间主 Agent 和复核 Agent 已执行：全量测试 251/253，两项 `test/agent-steward.test.ts:296` traversal 和 `:360` text parsing 超时；focused 重跑同样失败。类型、Svelte check、build 与当时格式检查通过。文档修改后不重复执行同一全量测试；最终 OpenSpec/格式结果以交接验证为准。

本轮重新运行 `pnpm test -- test/agent-steward.test.ts`，耗时约 417 秒，仍为 253 项中 251 通过、上述两项各超时 20 秒；没有新的 `src/`、`webui/`、`package.json` 或 `test/` 生产实现进入当前工作树。因此不能把“ZCode 已完成开发”作为当前仓库事实，后续必须先完成 runtime task 2.4b 并提供连续两次 focused green 证据。

超时并不能证明业务 pipeline 卡在哪里；测试在 createSkill、start、settled 等多个位置 await，根因尚未定位。traversal payload 还同时缺失 frontmatter/body，即使通过也只能证明 schema 拒绝，不能证明路径检查命中。整改需先用完整合法 fixture，再单独替换路径。

归档任务中的 253/253 声明与当前复跑不一致。保留原历史记录并附本轮复核说明，不据此推定当时伪造；它不能继续用于当前 release gate。真实模型运行、DSH Web composition、安装包 clean install 和事务 rollback 均无充分完成证据。

## Leadership Correction

我把“DSH 作为 Agent 开发基础”写成 ACP backend task，给了 ZCode 一个容易机械完成但产品方向错误的目标；又把 DSH WebUI 写成 optional，导致 settings/session/tool UI 可以全部省略。后续重复增加 remediation change，并提前将四 App 目标写入 AGENTS 当前事实，会进一步让 GLM 误判完成。

本轮修正：

- 移除重复 remediation change，收敛为 GOAL.md 的五阶段唯一任务归属。
- 用 `skill-steward-runtime/transaction-contract.md` 说明 snapshot、human approval、journal、资源树、split/merge 与恢复，纠正 validation 自动授权和跨文件 ACID 承诺。
- 用 `dsh-webui-composition/integration-contract.md` 锁定真实源码、root/slot、Svelte island、React 单实例、鉴权及最小真实挂载验收；复用 Manager views，不要求全量框架重写。
- 阅读用户所指的 `~/.zcode/AGENTS.md`，GOAL 明确安排契约、事务、UI composition、最终交付四个独立 Codex Terra/xhigh 复核关口；每次任务要求输入输出、反例和运行证据。
- 不把不可用测试当 DSH 集成通过，不把文本更短当 skill 更有效；最终阶段增加真实模型、效果样例与 pack clean-install。

## Handoff

唯一顺序：skill-steward-contracts -> skill-steward-runtime -> dsh-runtime-integration -> dsh-webui-composition -> steward-product-workflow。所有实现 checkbox 保持未完成。当前五个 change 是交给 ZCode 的执行计划，不是上线证书。

继续当前仓库：保留 Manager/Creator/Repository/CLI/Tray 基础。DSH 官方源码支持此次选择，但 alpha API 必须锁版本并实测。Codex 暂不进入本轮双后端交付范围；这是控制实现范围的决策，不是声称官方 Codex 缺乏 harness 能力。

交接文档验证：`openspec validate --all --strict` 9/9 通过（五个 change、四个主 spec），`pnpm exec vp fmt --check` 与 `git diff --check` 通过。五个 change 共 40 个 implementation checkbox 均未勾选。HTML 仅为结构参考，未取得本轮浏览器验证；应用生产代码未修改，未 commit/push。
