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
- [x] 1.7 验证门：全量绿 + webui check + ego-browser（两故事走查 + 键盘 + live
       run）+ 新鲜批评者批评环（9+ 门或停止条件收口）+ 进程回收
       （收口记录 2026-10-04：批评环 R1 6.4 → R2 8.1（处置 82f8478：断词
       wrap-anywhere 三处/toast lifecycle key 键控/Detail 头部容器查询降级；
       running 撞色项 CSS+像素采样证伪不改）→ R3 8.8（处置 de60ac9：layoutMode
       测量源容器化，Agent 面板挤压压溃拔除）→ R4 终判 9.4 过线、建议归档；
       两故事 R3/R4 复验 PASS；全量 214 文件 2180 测试绿（首跑 1 文件失败经
       两次独立复跑全绿判定为并行负载抖动）；webui check 0/0；R2-R4 三轮
       子代理进程回收证据齐——证据 /tmp/ia-redesign/screens-eval-r{2,3,4}/）
