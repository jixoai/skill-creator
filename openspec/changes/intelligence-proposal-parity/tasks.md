# Tasks: intelligence-proposal-parity

## 1. 模板与发起

- [x] 1.1 finding-propose-{edit,disable,split,merge}-v1 模板族（同 probe 协议：
      ID/版本/正文冻结、占位符、不自动发送）
- [x] 1.2 IntelligenceView 四动作改「经 agent 发起」（seed 面板 + finding
      上下文）；移除直连 propose 表单与调用

## 2. 投影统一

- [x] 2.1 agent.proposals.* 扩为统一审批面（skillIntelligence store 并入 +
      origin:agent-tool 标注；before/after + observed revisions + validation
      统一渲染）
- [x] 2.2 `skillIntelligence.propose` 从 rpc-contract 移除（破坏性）；webui
      引用清零

## 3. 测试与门禁

- [x] 3.1 四动作 seed 发起断言（模板版本 + 上下文注入 + 不自动发送）
- [x] 3.2 统一投影测试（双源合并、origin 标注、审批/拒绝路径不回退）
- [x] 3.3 直连路径清零断言（webui 无 skillIntelligence.propose 调用）
- [x] 3.4 门禁：focused tests + webui check + typecheck + fmt + full build

## 验收证据

- 3.1：`webui/src/lib/__tests__/agent-panel.test.ts`「finding-propose seed」
  四例（模板冻结渲染 + 不自动发送 + 惰性建会话元数据/引用透传 + 通用行动
  作废 pending seed）。
- 3.2：`test/agent-proposals-projection.test.ts` 投影单元（五态/失败结果/si
  草稿/前缀路由）+ 真实 domain 路由级双源合并（mcp:|si: 前缀 + origin 标注 +
  approve executed / reject rejected 不回退）；`test/e2e-authority-chain.test.ts`
  MCP 前缀消费链。
- 3.3：`webui/src/lib/__tests__/intelligence-direct-path-zero.test.ts` 源扫描
  零 `skillIntelligence.propose` 调用点。
- 3.4：pnpm test 1648/1648（168 files）；typecheck / webui check / vp fmt
  --check / git diff --check / pnpm build 全绿（archive 树入 .prettierignore，
  冻结历史不被 reflow）。
