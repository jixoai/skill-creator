# Tasks: steward-surface-closure

## 1. spec 收口

- [x] 1.1 `steward-product-workflow` Purpose 重写（去 DSH Web host 叙述）+ 首条
      Requirement MODIFIED（agent-internal with Manager authority；delta 过
      `openspec validate --strict`）
- [x] 1.2 `dsh-webui-composition` Purpose 重写为 headless 内核组合现实（无
      Requirement 变更，直接改主 spec 文本，proposal 记录）
- [x] 1.3 `agent-steward` spec 核对：确认无独立 UI route 要求 → 不改，核对结论
      记入 tasks
- [x] 1.4 调用路径证据（skills.relations 工具行、steward.* 8 RPC 零消费）写入
      change notes/proposal（已完成于 proposal，复核一遍）

## 2. 验证

- [x] 2.1 `openspec validate steward-surface-closure --strict` + 全 specs 校验
- [x] 2.2 零代码变更确认：`git diff` 只含 specs/docs/plans 文件
