# Tasks

- [x] 1.1 WorkspacesHome 挂载 effect 拆分：loadWorkspaces 与 agentSessions
      去依赖耦合（untrack 或独立 effect），消除 loaded/loading 翻转重跑
- [x] 1.2 workspace.list 首屏单发：layout connected-effect 与组件挂载
      去重（在途守卫或 loaded 守卫），断线重连仍可恢复
- [x] 2.1 registry.list() 单遍扫描合一（counts + keys 同源）+ 既有
      registry/projection 测试适配
- [x] 2.2 ccski root 扫描 skipPlugins（非 claude-code provider）；
      claude-code 语义保留并测试钉住
- [x] 3.1 skills-cli-probe boot 后台预热 + skills.list 不 await 未完成
      probe（provenance 缺省投影）
- [x] 3.2 skill-service 同 target discovery 短 TTL 缓存 + mutation 失效 + 聚焦测试
- [x] 4.1 实测验证：首屏帧计时前后对比（workspace.list 次数与耗时）
- [x] 4.2 门禁：typecheck / webui check / fmt / 聚焦测试全绿

## 实测（真实语料：50 global roots / 518 技能目录，CDP 帧计时）

- 冷首屏 workspace.list：3-4 次 × 1.76s（~5-7s 阻塞）→ **1 次 × 1.07s**
- 热首屏 workspace.list：**1 次 × 562ms**
- 进 provider skills.list 首次：787ms（discovery 真实成本）
- 点开技能 skills.info：27-156ms（重复 discovery）→ **40ms**（TTL 命中）
- npx probe（0-15s 冷启动）移出请求路径，boot 后台预热

## 附带：@opentray/ext-dialog 试用结论（用户指令 #2）

- 0.29.0 全链路试用发现上游 wire 不匹配（JS facade `{type, options}` vs
  Rust internally-tagged 平铺 + deny_unknown_fields → 所有 show 类命令
  `unknown field \`options\``，仅 getBackend 可用）——已发
  jixoai/opentray#8，opentray 升级回滚，集成待上游修复。
