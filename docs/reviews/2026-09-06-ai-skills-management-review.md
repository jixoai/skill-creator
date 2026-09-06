# AI Skills Management Review

日期：2026-09-06

状态：早期基线笔记，已由 `2026-09-06-zcode-agent-steward-review.md` 替代。执行顺序只读取 GOAL.md 的五阶段清单；本文不能作为新实现验收证据。

## Verdict

当前实现不能通过 AI-SKILLS-MANAGEMENT 复核。综合评分：**4.5/10**。

代码的 Manager、确定性 Intelligence、revision 和 approval 基础有价值；但 Agent 产品边界仍是 ACP bridge + 通用对话，而不是技能管家。该偏差属于架构级阻塞，不应继续在旧 `agent-steward` 上加功能。

## Evidence

| Requirement                | Current evidence                                                                                                                                                                                                | Verdict           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 专属技能工具               | `src/daemon/steward-service.ts` 从 Agent 最终文本提取 JSON；没有 `skills.list_context/inspect/relations/propose/validate/apply/rollback` tool registry                                                          | Missing           |
| 专属提示词                 | DSH/Codex adapter 拼接 objective、findings 和 output contract；没有版本化 Skill Steward system prompt/task templates                                                                                            | Missing           |
| 专属工作流                 | `StewardView.svelte` 展示通用 run、recommendation 和 approval；没有 scope/task/context snapshot/tool call lifecycle                                                                                             | Partial           |
| DSH WebUI 融合             | 当时只发现 `/Users/kzf/Dev/GitHub/dsh` 的 `dsh-herdr` 插件；官方源码审计现已独立记录于 `openspec/changes/skill-steward-contracts/artifacts/dsh-webui-audit.md` 与 `docs/research/2026-09-06-dsh-integration.md` | Missing（旧实现） |
| ACP 是内部传输而非产品边界 | `src/daemon/acp-bridge-service.ts`、`webui/src/lib/components/creator/acp-panel.svelte`、README ACP surface 仍是生产主路径                                                                                      | Failed            |
| Manager authority          | revision/approval/path safety 基础存在，旧 steward 测试覆盖部分越权和生命周期                                                                                                                                   | Partial           |

## Blocking findings

1. `dsh-adapter.ts` 默认执行 `dsh-acp`。官方确有 ACP profile，但不能满足本次定制 tools/prompts/workflows 与 WebUI 合并目标；实机 unavailable 不能算 DSH 集成完成。
2. Agent 没有领域工具调用协议，因而不能可靠执行“禁用、分析、优化、拆分、合并”。自然语言中的 JSON 不能作为 mutation contract。
3. 现有 ACP Creator 面板允许用户直接与任意 ACP-capable CLI 对话，和 Skill Steward 的 scope、snapshot、evidence、proposal、approval 语义脱节。
4. 新目标保留在 active change deltas，主规格在实际实现验收后同步，不能提前表示为完成事实。

## Required next proof

ZCode 下一轮必须先交付 `skill-steward-contracts`，再交付 `skill-steward-runtime` 的 fixture vertical slice，最后接 DSH。最小可接受证据是：一个真实 run 固定 skill snapshot 和 prompt version，调用至少三个 Manager-owned skill tools，产生带 evidence/revision 的 proposal，经 validation 和一次性 approval 后 apply/rollback；Agent 无通用文件或 shell 工具；DSH unavailable 时手工 Manager 与 deterministic Intelligence 仍可用。

本报告不是实现完成证明；它是下一轮 OpenSpec 执行的审查基线。
