# Design: skill-search-integration

> 前置：2026-09-17-skill-search（已归档）交付的检索域是本 change 的唯一
> 搜索实现；本 change 只做消费方接线，不触碰检索域内部冻结合同。

## 接线（最小改动集，经代码实调确认）

```text
src/shared/rpc-contract.ts ---------------- SkillsSearchInputSchema 导出 + search procedure
src/daemon/domain.ts ---------------------- DaemonDomain.skillSearch 单例（capabilities 之前装配）
src/daemon/rpc-router.ts ------------------ skills.search handler（一行闭包接线）
src/daemon/capability/domain-capabilities.ts Pick 增 "skillSearch" + skills.search readonly 项
src/daemon/kernel/agent-modes.ts ---------- skills_search 进 create/manage/explore 的 tools
```

零改动：skill-creator-mcp.ts（capability 自动投影）、dsh-kernel.ts
（`mcp__skill-creator__` 前缀通配 + 运行时 tools/list）、webui rpc-client
（类型自动推导，GUI change 直接消费）。

## 关键决策

1. **daemon 长驻单例**：`createSkillSearchService()` 构造一次，跨 RPC 保活。
   索引首查惰性加载、后续 stat 增量——1~2k skills 的 RSS ~10-20MB，daemon
   可接受；每次 search 的 root 解析重读 catalog + 持久态，workspace 增删
   自动生效。
2. **空 query = 输入校验错误**：schema `min(1)` 直接产生 typed error
   （service 层返回空数组的行为保留给内部调用，不进入 RPC 合同）。
3. **MCP 走 capability registry**：登记即投影，stdio/in-process 双面可用；
   readonly 无 propose；结果为结构化列表（ui:// 卡留后续增强）。
4. **模式面**：`skills_search` 加入全部专注模式 tools（用户裁决「任何模式
   都能检索」）；不改 AGENT_ROLES 角色能力面（后续按需）。

## 测试

- test/rpc-search.test.ts：沙箱 home + 真实 domain，oRPC client 断言结果
  契约/作用域三元组/空 query typed 错误/IO 故障透传（可选注入）。
- test/skill-creator-mcp.test.ts：stdio face 工具在场 + 调用往返 +
  propose 类 mutation 面不因本变更扩张。
- test/capability-domain.test.ts：DOMAIN_AUTHORITY 表 + mapProcedures
  全集 + stubDomain 同步增 skills.search。
- test/agent-modes.test.ts：三专注模式 tools 含 skills_search；free 保持
  null。
- 验证门：pnpm check / build；`skills_search` 与 `skills.search` 命名
  grep 自查（无第二份手写类型）。
