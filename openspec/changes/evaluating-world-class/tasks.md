# Tasks: evaluating-world-class

- [x] 1.1 数据投影核对：results.list 断言级 expected/observed 文本是否在契约内
       （缺则最小扩展 + spec delta 回填 evaluation-corpus）
- [x] 1.2 store 扩展：run 时间线 + case 树投影（每-case-最新 + 断言行展开数据）
       + 键盘导航纯函数（latest-request-wins 范本）
- [x] 1.3 总览屏重做：近期 runs 时间线 + 健康度卡（通过率环/三态计数/stale 带/
       失败摘要行）+ 空态引导（Creator test 链）
- [x] 1.4 详情屏重做：run 选择器（live 进度）+ case 步骤树（失败默认展开/记忆/
       ?case= 深链）+ 断言详情（期望 vs 观测 diff 双栏记忆点 + finding 触发标记
       + revision stale 判读）+ 键盘 ↑↓/Enter/Esc
- [x] 1.5 case 管理收进折叠区（诊断优先）；Imported-only 门控沿旧
- [x] 1.6 i18n C 类（en=zh 齐全）+ 三尺寸（双栏/抽屉/单列 push）
- [ ] 1.7 验证门：全量绿 + webui check + ego-browser（两故事走查 + 键盘 + live
       run）+ 新鲜批评者批评环（9+ 门或停止条件收口）+ 进程回收
       （测试/check 部分已过：webui check 0/0、evaluation 五套件 39+71 绿、
       pnpm typecheck 绿；ego-browser 与批评环归编排者）
