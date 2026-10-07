# ccski-3-host-migration · host 收据汇总（批 4 收尾物）

> 用途：MainAgent 据此到 ccski 仓勾选 store-link-kernel 批 6 第 2/3 项（跨仓项）；
> 本仓子代理不改动 ccski 仓。三件收据均在本 change 目录。

## 1. wrapper-retirement-receipt.md（批 6 第 2 项：宿主无漂移复跑收据）

- 内容：同一 fixture 语料（真实目录 enabled/disabled + symlink
  enabled/disabled-only/非 skill 目标/坏 frontmatter/悬空链），wrapper 在场
  （listSkillsWithSymlinkedEntries）vs 直连 ccski 3.0 listSkills，两种调用形状
  （all:true / all:false），消费口径 7 字段（provider/location/sourceKind/
  sourcePriority/disabled/canonicalPath(=mutation target)/directoryName）逐行对照。
- 结论：**漂移行总数 = 0（全等）**；wrapper 增补在 3.0 一等发现下实证 no-op。
  已知分析性差异（非漂移）：3.0 发现行额外携带 entryKind/canonicalPath/ownership/
  mode 增量字段（宿主 z.object 收窄剥离；且为批 2.3 toggle 双路由依赖面）。
- 后续状态：wrapper + 其测试已删除；skill-service / workspace-registry 两调用点
  直连 ccski 3.0；AGENTS.md Self Skill 条目已改写为 3.0 一等发现真相。

## 2. walkthrough-evidence.md（批 6 第 3 项：dev 沙箱全链真实交互收据）

- 环境：标准 `pnpm dev`（dev home /tmp/sc-v2，未触碰真实 ~/.agents 与
  ~/.skill-creator）；源 = curated Anthropic Skills（真网络 pinned clone
  683bc88e56f3…）。
- 链路：W1 导入 ws → W2 Repository pin→preview→install（Installed 1；两阶段
  物理：实体 + symlink 投影 + state 记账 + 内容与上游逐位一致）→ W3 唯一逻辑名
  分组（20 provider face → 1 组，两量纲计数）→ W3-b duplicates 角标（双 canonical
  同 contentHash，duplicates-only 过滤 0→1 行）→ W4 SkillDetail（树 + 内容查看器
  读实体正文 + 双路径 + 启停文案）→ W5 物理摘链禁用 + **列表仍见 disabled 补充行
  （批 3.2 生效：state 记录 + 实体内容源，"claude-code Disabled" 徽标）**→ W6
  同 id 重启用链接重建（往返闭合）→ W7 update check/apply 诚实面 → W8 remove。
- console 零新增错误；CDP 截图 1 张 bonus。
- 走查发现（供后续批次，均非批 3/4 引入）：
  - F-1 post-boot 导入 ws 的 roots 不入搜索索引 watch 集（新鲜度缺口）；
  - F-2 CLI update check/apply 在 probeWarmup:false 短命进程恒空/恒拒
    （updatable 冻结于 list 时）；
  - F-3 宿主无内核感知卸载面（removeEntityProjections/deleteEntity 零引用；
    Creator rmSync 对 symlink face 被 containment 拒、对 entity face 删实体留
    悬空链 + stale state）。

## 3. 五件套数字（2026-10-08 走查前时点，全部 exit 0）

| 门禁                               | 命令                       | 结果                                                                                                                                                       |
| ---------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 测试（全量 ×2：改动后 + build 后） | `pnpm test`                | exit 0；232 文件 / **2393/2393**（两次全绿；已知 watcher 抖动未出现）                                                                                      |
| 类型                               | `pnpm typecheck`           | exit 0                                                                                                                                                     |
| WebUI                              | `pnpm --dir webui check`   | exit 0（0 errors / 0 warnings）                                                                                                                            |
| 构建                               | `pnpm build`               | exit 0（bundle 含 ccski-state-disabled 模块；webui staged）                                                                                                |
| 格式                               | `pnpm exec vp fmt --check` | 任务文件全过；剩余 3 个 = main 既有欠账（openspec/changes/webui-i18n-bilingual/inventory.md、specs/creator/spec.md、specs/human-terminal/spec.md，未触碰） |
| diff 卫生                          | `git diff --check`         | exit 0（无 whitespace 错误）                                                                                                                               |
| 包内容                             | `npm pack --dry-run`       | exit 0（142 files，skill-creator-2.6.0.tgz）                                                                                                               |

聚焦测试：skill-service 12/12（批 3.2 全链）、skill-detail dom 13/13（批 3.3/3.4）、
退役前对照聚焦 51/51。

## 环境恢复记录

- 走查前生产 daemon：PID 10556（port 62481，tray mounted）——`pnpm dev` 按预期
  自动停止。
- 走查后：dev 环境（vite + dev daemon ×2 轮）随 supervisor 停止；
  `pnpm skill-creator stop` 双端点探测 = 无存活 daemon（dev 端点
  /tmp/sc-v2/.skill-creator/run/skill-creator.sock 已释放）；端口 5174/53785 无监听；
  本任务进程全回收（dev daemon/vite/agent-browser 会话守护进程 PID 58113
  `close --all` 后确认退出；扫描中其余 node 进程为其它会话/项目所有，非本任务
  起动——design.mjs、agenter2 vite、贴钻-backend 等）。
- 生产恢复：`pnpm skill-creator start` → **新 PID 67628**（port 54544，tray
  mounted，version 2.6.0，dsh mounted 94 entries）；status 实测如上。

## 走查沙箱残留说明

`/tmp/ccski3-walkthrough/`（含 walkthrough ws、悬空链现场、bonus 截图）与
`/tmp/sc-v2/`（dev home）保留至 MainAgent 复核，均位于 /tmp（重启即清），不涉及
真实 home 与仓库工作树。
