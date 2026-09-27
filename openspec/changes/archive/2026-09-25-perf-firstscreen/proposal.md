# Proposal: perf first screen — 首屏与读路径的低风险性能修复

## Why

用户反馈 [2026-09-18]：「性能很差，经常 loading，想办法在整个架构链路中做
合理的优化。」性能剖析（真实语料：catalog 75 providers / 存在 50 global
roots / 518 技能目录 / 4.6MB SKILL.md）实测定位三个杀手：

1. **`workspaces.list` 单次 1.76s 同步 IO 阻塞事件循环**：registry 投影对
   50 个 roots 各跑两遍 ccski 全量扫描（countWorkspaceSnapshot 并行遍
   1187ms + collectWorkspaceSkillKeys 串行遍 572ms），每遍 = 递归 readdir
   全树 + 518 个 SKILL.md 完整读取 + YAML/Zod 解析 + 50 次重复的 Claude
   插件全局发现副作用。
2. **首屏 3-4 倍请求放大**：WorkspacesHome 挂载 effect 依赖
   agentSessionsList（loaded/loading 翻转重跑）+ layout connected-effect
   双入口无去重 → 首屏 3-4 次 × 1.76s ≈ 5-7s 阻塞。
3. **`skills.list` 系列无缓存 + npx probe 阻塞**：进 provider / 点开
   info / toggle / validate 都重跑整 root discovery（27-156ms/次）；首次
   还串行 await `npx skills list --json`（上限 15s）。

## What Changes（低风险档，协议与数据形状不变）

- **P1 WebUI 首屏去重**：WorkspacesHome 的加载 effect 拆分/untrack
  agentSessions 依赖；workspace.list 连接重试以「在途/已有数据」守卫，
  首屏只发 1 次。
- **P2 registry 双遍扫描合一**：`registry.list()` 单次 `listSkills` 同时
  产出 counts 与 keys（数据源相同）；revision retry 语义不变。
- **P3 ccski 扫描 skipPlugins**：非 claude-code provider 的 root 扫描跳过
  `discoverPluginSkills` 全局副作用（claude provider 保留语义）。
- **P4 npx probe 出请求路径**：daemon boot 后台预热 fire-and-forget；
  `skills.list` 不 await 未完成 probe（provenance 缺省，到位后下次投影）。
- **P5 skill-service discovery 短 TTL 缓存**：同 target 的
  resolveSkill/info/toggle/validate 复用短 TTL discovery 结果；mutation
  （toggle/rename）后失效。

## Impact

- 预期：首屏 ~5-7s → <2s；进 provider 首次消除 0-15s npx 尾延迟；点开
  技能 30-160ms → ~0。
- 不改：RPC 协议形状、registry 持久态、skill-search 索引语义。
- 根治路径（skillCount 消费 skill-search 索引、WS 订阅推送）另立 change。

## 复核处置记录（codex perf-review，2026-09-18）

- P1-1/P1-2（repository install 写后失效、in-flight 绑 connection
  generation）已修复；P2 哨兵路径进程唯一化、probe 预热 catch、本 delta
  的 TTL→在途合并语义同步均已落地。
- 已接受的残留：ccski `discoverPluginSkills` 对 pluginsFile 缺失静默跳过，
  但 `~/.claude/settings.json` 的单文件读取仍发生（ccski API 未暴露
  settings 隔离口）；成本远小于原插件目录遍历，接受为已知边界，根治随
  ccski 上游 skipPlugins 透传或 B-7 索引化。
