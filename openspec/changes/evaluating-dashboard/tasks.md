# Tasks: evaluating-dashboard

- [x] 1.1 evaluation.overview 聚合 RPC（有界扇出 + targets 字典序 cursor 分页 + targets[].error typed 投影 + recentRuns 固定窗口 20 + staleRatio
      revision 现读；单测覆盖 design §5 overview 六态）+ Global run.start
      排队前前置拒（adapter 未调用断言——r2 修订）
- [ ] 1.2 总览屏（技能卡网格 + 近期 runs 行 + Run 显式确认；点卡跳三段
      详情路由）
- [ ] 1.3 详情面（eval-view 迁移 + 三段路由 /w/:wsId/evaluating/:providerId/
      :skillId + cases 表 + 失败断言展开 + case 编辑 Imported-only）
- [ ] 1.4 Creator test/eval 子视图退役 + 深链接续（三段路由）
- [ ] 1.5 非零 errors 红 chip 真实语料抽查断言（残留台账项）
- [ ] 1.6 i18n：完成时在 webui-i18n-bilingual 的 inventory.md 标记对应 C 类
      面完成并双语适配（唯一帐本 = 该 change）
- [ ] 1.7 验证门：全量绿 + webui check + ego-browser（总览→详情→run→cancel 链）+ vision 验收 + 进程回收
