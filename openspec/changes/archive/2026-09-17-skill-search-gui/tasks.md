# Tasks

- [x] 1.1 skills store：searchRequests 代次门 + searchState + searchSkills
      动作（空 query 不发请求清结果；isCurrent/isLatest 分工）+ store 单测
      （webui/src/lib/stores/**tests**/skills-search.test.ts，5 用例）
- [x] 1.2 ProviderView：debounce 输入 → searchSkills；列表渲染检索投影
      （空 q 全量）；失败降级前端 includes + 错误提示
      （走查 Case B PASS：kill daemon 后降级 banner + 本地过滤存活，恢复后回归，
      证据 /tmp/ssgui-walkthrough/shots/B1–B3）
- [x] 1.3 命令面板：异步 Skills 组（CommandLoading / 分组 / 详情跳转）
      （走查 Case C 首轮 FAIL：P1 bind:value 绑在 Command.Dialog 根（bits-ui
      Root 的 value 是选中条目值）致检索永不触发 + 选中污染 query；P2 关闭未
      配对清空致永久 Searching。已修复：bind 移到 Command.Input + 关闭时
      query/resetSkillSearch 配对清空；契约 stub 回归测试
      webui/src/lib/**tests**/command-palette-search.test.ts（变异验证命中）；
      真实浏览器 CDP 复验 P1/P2 PASS——「组件」2 行双安装归属、「react」3 行、
      选中重开输入为空）
- [x] 1.4 SkillMenu：去全量拉取，debounce → skills.search，installations
      派生行与组头，空 needle 占位，断线 getRpc() 失败先例 + 组件测试
      （走查 Case D PASS：$组件 → 1 skill · 2 provider groups 双安装行、
      $zomponent typo 召回 3、选中落稿芯片；证据 shots/D1–D2；
      webui/src/lib/**tests**/skill-menu.test.ts 5 用例）
- [x] 1.5 验证门：pnpm check / pnpm build 全绿
      （聚焦 12/12→13/13（palette 回归 2 + store 5 + skill-menu 6）、svelte-check
      0 错、tsc 干净、vp fmt --check 通过。勘误：首检的聚合 check 因测试阶段
      抖动未跑到 fmt 阶段，本文件自身格式违规漏网且被误记为「fmt 通过」——
      codex 复审（NEEDS-WORK 8.6）抓包后已格式化并全静态链复跑通过）
- [x] 1.6 vision 子代理真实走查（沙箱 dev 实例，桌面 + ≤720px 窄屏，
      三链路 + console 零错误，截图留证）；发现项回修后复走查
      （两轮 vision 子代理：A1–A5 + B/D/E/F 全 PASS，C 发现 P1/P2 后回修并
      经真实浏览器复验闭合；窄屏 420px DOM 断言无横向溢出（E1/E2）；交互
      窗口 console 零 error 零 exception（console-log.jsonl）；遗留 P3：
      面板 Esc/外点 dismiss 需可见窗口人工复验、检索失败静默无诊断日志、
      沙箱 DSH kernel 插件 ENOENT 降级（超出本 change 范围））
- [x] 1.7 codex 复审处置（NEEDS-WORK 8.6 → 修复后复核）
      （真实跑门 + 双向变异验证：P1 变异命中；P2 原测试未钉根因（未先输入即
      关闭）——已补「先输入再选中」场景；SkillMenu 离开 `$` 态/卸载现经
      resetSkillSearch 作废在途检索并回收共享 searchState（新增用例钉死）；
      tasks.md 格式与误记已勘误。上轮阻塞仅 tasks.md fmt，修复后可转 APPROVE）
