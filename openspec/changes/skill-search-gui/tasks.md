# Tasks

- [ ] 1.1 skills store：searchRequests 代次门 + searchState + searchSkills
      动作（空 query 不发请求清结果；isCurrent/isLatest 分工）+ store 单测
- [ ] 1.2 ProviderView：debounce 输入 → searchSkills；列表渲染检索投影
      （空 q 全量）；失败降级前端 includes + 错误提示
- [ ] 1.3 命令面板：异步 Skills 组（CommandLoading / 分组 / 详情跳转）
- [ ] 1.4 SkillMenu：去全量拉取，debounce → skills.search，installations
      派生行与组头，空 needle 占位，断线 getRpc() 失败先例 + 组件测试
- [ ] 1.5 验证门：pnpm check / pnpm build 全绿
- [ ] 1.6 vision 子代理真实走查（沙箱 dev 实例，桌面 + ≤720px 窄屏，
      三链路 + console 零错误，截图留证）；发现项回修后复走查
