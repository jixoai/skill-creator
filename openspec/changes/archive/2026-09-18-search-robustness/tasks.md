# Tasks

- [x] 1.1 search-config.ts：TOML 模板/原子写/解析收窄/configDigest + 单测
      （缺省/合法/注释/畸形/追加语义/IO 硬错误）
- [x] 1.2 额外 md 收集与正文合并：collectExtraMarkdown（排除/深度/数量/
      symlink/确定性）+ parser 扩展（per-file 6k、合计 12k）+ contentHash
      文件集语义 + 单测
- [x] 1.3 canonicalize stat 文件集形状 + index 信封 v3（schemaVersion 3、
      files stat、configDigest、v2 废弃重建）+ 增量单测（增删改/保时保长）
- [x] 1.4 watcher.ts：watch/reconcile/dirty/去抖同步 freshen（≤20k）/
      lazy 降级/unwatched 回退/dispose 无泄漏 + 单测
- [x] 1.5 service 装配：config 载入、watcher 接入 search 路径（clean 跳过
      扫描）、dispose 导出；daemon/index.ts stop coordinator 接线
- [x] 1.6 RPC `skills.searchConfig.open`（契约 + capability 登记 + 平台
      opener + 沙箱 stub 单测）+ webui 入口（palette 命令 + ProviderView
      过滤栏图标）
- [x] 1.7 小包：SEARCH_DEBOUNCE_MS 集中导出、palette scope 字段类型、
      console.debug 诊断、安装→可搜集成测试
- [x] 1.8 Q4 Windows 实证：ssh gaubeehonor 聚焦测试 + CLI smoke；差异
      修复带复跑证据（预期：ino/大小写/rename/recursive watch）
- [x] 1.9 验证门：pnpm check / build 全绿 + 索引基准复跑（新内容范围不
      回退既有 Recall/MRR）
- [x] 1.10 vision 走查：真实可见窗口 Esc/dismiss 复验、配置入口、排除
      目录 fixture（node_modules md 不影响检索）；发现回修后复验

## 复核与走查证据（R1→处置→复验闭环）

- Windows 实测（gaubeehonor，win32 x64 / Node 26.3.1 / pnpm 12.3.4 经 npx 缓存
  修复）：首轮 85/102 → 三类根因修复（USERPROFILE 隔离 / chmod 注入平台化 /
  路径 posix 归一）→ 终轮 14 文件 102/102 全绿（bundle 离线同步）。
- codex R1 复核 NEEDS-WORK 4.6（/tmp/skill-search-poc/codex-robust-review-r1.md）：
  4 P1 + 2 P2 全部处置（65bc0a2）；watcher 时序 3 失败改确定性 seam 后稳定。
- vision 走查（可见窗口 + CDP 可信事件）：W1 Esc/外点 PASS（复审遗留复验项
  闭合）、W2 额外 md/排除 PASS、W3 配置入口 PASS（TextEdit 未弹为 .toml 无
  关联应用，已按 P3 补退出码 typed 失败）、W5 中文 PASS；W4 FAIL 根因 = 重复组
  加载风暴（已修），修复后 CDP 复验：区块渲染 + 跳转 + 入口全过。
- 基准：R@5=0.993 R@10=0.993 MRR=0.959 typoR@5=1.00（内容范围扩展不回退）。
