# Design: skill-steward-contracts

## Product topology

```text
Skill Creator Shell
  |-- Manager: Workspaces / Creator / Repository
  |-- Skill Steward contracts: snapshot + task + finding + patch
  `-- Agent Runtime (later): fixture tests -> DSH production

Agent Runtime owns: model session, stream, tool transport, capability status
Skill Creator owns: skill snapshot, tool authority, proposal, validation, apply, rollback, audit
```

本阶段只定义 seam，不实现 DSH WebUI。官方 DSH 的 agent/session/tool/system-prompt/preset/approval 能力见 `artifacts/dsh-webui-audit.md`；其 store、profile 与 session log 不能替代 Manager 的 Workspace、Provider、Skill、revision 和 proposal。

## Domain workflow

```text
scope + task
      |
      v
immutable snapshot (ids + revisions + bounded content)
      |
      v
typed tool calls -> findings / patch draft -> validation -> approval -> apply
```

专属工具是有限、typed、可审计的 Manager operations，而不是通用 `read_file`/`write_file`/shell：`skills.list_context`、`skills.inspect`、`skills.relations`、`skills.propose`、`skills.validate_proposal`、`skills.apply_proposal`、`skills.rollback`。每次调用记录 input、result、observed revision、权限和 run id。

`skills.rollback` 只生成 Manager-derived reverse proposal，不能直接写入；仍须人类审批和 `skills.apply_proposal`。Codex 后端不属于本轮实现范围。

## Prompt and output contract

系统提示词固定 Agent 身份、范围、证据要求和禁止事项：Agent 是技能管家；不得直接修改 Provider；不得凭相似文本断言冲突；每个建议必须引用 skill id、revision 和 evidence；不确定时输出 `needs-review`。提示词和版本写入 run record。

Agent 输出只允许解析为结构化 `SkillStewardResponse`：阶段事件、finding、proposal、question、terminal reason。未知 action 或缺少 evidence/revision/version 必须拒绝；自然语言仅作为 transcript 展示，不能驱动 mutation。

## Safety invariants

- 每个 run 固定 snapshot、promptVersion、toolVersion 和 backend capabilities。
- proposal 只能引用 snapshot 中的 skill identity；revision 变化后自动 stale。
- 任何写入都由后续 Manager apply 完成，不能从 runtime 直接取得 Provider 文件句柄。
- approval token 一次性消费；validation、apply、rollback 都重新执行路径与 revision 检查。
- validation 返回报告，不签发 authorization；仅已鉴权人类 approve RPC 产生 Manager-owned grant，模型工具不可签发。详情见下一阶段 `../skill-steward-runtime/transaction-contract.md`。
- Agent 可以通过结构化 proposal 携带新的 semantic finding evidence，Manager 校验 snapshot 引用后分配 finding id；不能因 deterministic analyzer 未发现问题而禁止所有优化。
