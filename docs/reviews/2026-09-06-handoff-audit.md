<!--
原始需求（2026-09-06）：review ZCode 交付，纠正 ACP 误解，通过 changes 和 GOAL.md 安排专属技能管家开发。
意图：1. 对照交接要求记录证据；2. 区分规划完成与产品验收。
-->

# Review And Handoff Audit

本轮目标是审查已有交付、修正规划并交给 ZCode 实现。复核时最新提交仍为 `ba63b41`，实现提交为 `27446f7`；当前工作树没有 `src/`、`webui/`、`package.json` 或 `test/` 的新改动，只有文档规划变更。源码仍包含 `src/daemon/steward/dsh-adapter.ts` 的默认 `dsh-acp` 和 ACP `session/new` / `session/prompt`。上一轮属于有效进展：修正了阶段任务归属、DSH 插件复用要求和回滚审批契约，并完成文档验证。

后续复核再次确认：`git log` 仍停在 `ba63b41`，唯一分支为 `main`；生产路径 diff 为空；`openspec list --json` 仍显示五个 change、43 个任务、全部 0 completed。此状态是“等待 ZCode 实现”的事实，不是通过或 blocked 结论。

在连续多轮后续复核中，以上外部状态没有变化。由于当前没有新的生产 diff、任务证据或运行产物，无法继续对“ZCode 已完成的开发”进行事实 review；下一次有意义的动作必须来自新的 `src/`、`webui/`、`test/`、package/build 产物或可复现运行证据。

| 用户要求                      | 当前交付证据                                                                                                | 判定                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------ |
| review ZCode 开发             | `2026-09-06-zcode-agent-steward-review.md` 固定提交范围、源码位置、测试结果及分级缺陷                       | 已交付；当前产品不通过         |
| leader 承担规划错误并调整管理 | review 的 Leadership Correction；GOAL 的小任务、失败诊断、独立复核与证据规则                                | 已交付                         |
| 阅读 ZCode 日常工作流         | 已完整读取实际 `~/.zcode/AGENTS.md`；GOAL 使用 RemixCode/Terra 复核和资源回收约束                           | 已完成；AGETNS 为拼写差异      |
| DSH 作为 Agent 开发基础       | 官方源码审计 `../research/2026-09-06-dsh-integration.md`；阶段 3 明确实际 packages、tools 与 prompts        | 已规划；尚未实现               |
| 合并 Agent 配置与交互 UI      | 阶段 4 的 proposal/design/spec/tasks 和 integration-contract；强制复用官方 client plugins                   | 已规划；尚未实现               |
| 专属工具、提示词、工作流      | 阶段 1 的七类工具、四类 patch、版本化 check/optimize/organize；阶段 2/3 负责执行                            | 已规划；尚未实现               |
| 单个及多个 skills 可视化      | 阶段 5 spec 的 individual/relationships 场景，任务 4.2/4.6/4.7                                              | 已规划；尚未实现               |
| 禁用、改进、拆分、合并        | 阶段 1 闭合 patch union；阶段 2 transaction-contract；阶段 5 action 验收                                    | 已规划；尚未实现               |
| skills 效率更好               | 阶段 5 的 baseline/candidate、正反触发样例、任务断言和资源有效性验收                                        | 已规划；没有声称当前已提升     |
| changes 与 AgentLoop GOAL     | 五个 active changes，按当前 `openspec list --json` 共 43 项未勾选 tasks；根 GOAL 固定唯一阶段顺序与完成门禁 | 已交付                         |
| 产品级应用，不能用 DEMO 代替  | GOAL 要求真实模型、真实 DSH、完整资源变更/恢复、生产包干净安装与独立终审                                    | 已规划；不授予当前产品上线结论 |

文档门禁：OpenSpec strict 9/9、全仓格式检查和 diff 检查通过；对最后补充的规格和本文再次运行对应检查。HTML 仅结构参考，未做本轮浏览器验证。此次重新运行 `pnpm test -- test/agent-steward.test.ts`，结果仍为 251/253，两个 20 秒 timeout，整次耗时约 417 秒；根因尚未被证明，已加入 runtime task 2.4b，禁止用提高 timeout 或删断言消除红灯。

复核 agent 的意见须以主审报告为准：没有将历史测试不一致定性为造假，没有把每个 RPC namespace 机械计为独立文件意图，也没有把 Steward 位于 Workspaces activity 本身判为用户需求违约。当前未取得额外的独立规划终审结论，不声称其已通过；ZCode 后续四个复核关口仍须实际执行。

没有执行生产实现、commit、push 或发布。本审计完成的是用户指定的 review 与整改交接；应用上线必须满足 GOAL.md 的全部产品验收条件。GOAL 新增生产路径差异门槛：只改 OpenSpec/文档不能勾选 implementation task，也不能形成上线结论。
