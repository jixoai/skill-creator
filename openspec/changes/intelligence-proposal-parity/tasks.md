# Tasks: intelligence-proposal-parity

## 1. 模板与发起

- [ ] 1.1 finding-propose-{edit,disable,split,merge}-v1 模板族（同 probe 协议：
      ID/版本/正文冻结、占位符、不自动发送）
- [ ] 1.2 IntelligenceView 四动作改「经 agent 发起」（seed 面板 + finding
      上下文）；移除直连 propose 表单与调用

## 2. 投影统一

- [ ] 2.1 agent.proposals.* 扩为统一审批面（skillIntelligence store 并入 +
      origin:agent-tool 标注；before/after + observed revisions + validation
      统一渲染）
- [ ] 2.2 `skillIntelligence.propose` 从 rpc-contract 移除（破坏性）；webui
      引用清零

## 3. 测试与门禁

- [ ] 3.1 四动作 seed 发起断言（模板版本 + 上下文注入 + 不自动发送）
- [ ] 3.2 统一投影测试（双源合并、origin 标注、审批/拒绝路径不回退）
- [ ] 3.3 直连路径清零断言（webui 无 skillIntelligence.propose 调用）
- [ ] 3.4 门禁：focused tests + webui check + typecheck + fmt + full build
