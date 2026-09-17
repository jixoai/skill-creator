# Tasks

- [x] 1.1 契约：rpc-contract.ts 增 SkillsSearchInputSchema（query min-1 +
      limit 1..50 可选，复用 contracts/search.ts）+ skills.search procedure
      （输出 {results: SkillSearchResult[]}）
- [x] 1.2 domain：DaemonDomain 增 skillSearch 单例（createSkillSearchService()
      零参，capabilities 装配之前）
- [x] 1.3 router：skills.search handler 接线（domainErrorBoundary 语义）
- [x] 1.4 capability：domain-capabilities.ts Pick 增 "skillSearch" +
      登记 skills.search readonly 项；capability-domain.test.ts 三处同步
      （DOMAIN_AUTHORITY / mapProcedures / stubDomain）
- [x] 1.5 内核：agent-modes.ts 的 create/manage/explore tools 数组加
      skills_search（free 保持 null）；agent-modes.test.ts 断言
- [x] 1.6 测试：test/rpc-search.test.ts（结果契约/作用域三元组/空 query
      typed 错误）+ skill-creator-mcp.test.ts 增 stdio face skills_search
      在场与调用往返
- [x] 1.7 验证门：pnpm check / pnpm build 全绿；grep 自查无第二份结果类型
