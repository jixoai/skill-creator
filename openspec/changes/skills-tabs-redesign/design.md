# Design: skills-tabs-redesign

依据：Owner 批准的 fuse2 布局基准（/tmp/skills-redesign/fuse2/vision/）+ Codex 接口评审（/tmp/skills-integration/codex-review.md，2026-10-06，五 Δ 全部收窄、Δ3 原方案否决）。本文件是评审结论 + MainAgent 对十个开放问题的裁决，批 2-5 以此为准。

## Δ1 唯一技能投影（定稿）

- **复用不重建**：分组投影基于现有 `skills.listWorkspace` / `skill-search/workspace-aggregate`（已具备 provider fan-out、`(providerId, skillId)` 稳定排序、contentHash 有界重复投影），不建第二套扫描/去重管线。
- **workspace-scoped 输入**：`{ wsId, q?, pagination? }`；不是脱离 target 的全局 list。
- **group 形态**：`{ name, description, representative, copies[], groupMeta }`；representative 与每个 copy 都携带完整 `WorkspaceProviderTarget`（workspaceId/providerId/skillId）——现行 info/toggle/validate 都按 target 解析，这是安全边界不是 UI 约定。
- **分组键**：skill name 精确匹配（trim 空白外不做大小写折叠/Unicode 归一）；plugin namespace 前缀原样入键。contentHash 仅在组内区分「同内容副本 / 同名不同内容」，不作列表身份。
- **representative 规则**：enabled 优先 → sourcePriority（缺失视为最低）→ providerId 字典序 → path 字典序；provider unavailable → 组保留、该 copy 标记 unavailable、代表顺延；全组不可用 → 行保留置灰不隐藏；SKILL.md/.SKILL.md conflict 时该 copy 视为携带 conflict 标记参与规则，不整体丢弃。
- **计数**：`groupCount` 与 `copyCount` 分开返回、UI 分开明示（「技能组 / 安装副本」两量纲，禁止单数字推导）。

## Δ2 文件树与文件读（定稿）

- **每次调用重新解析**：`fileRead` 不信任先前 `files` 列表（entries 会过期）；每次以 server-owned target + opaque skillId resolve 后对相对路径逐级验证。复用搜索面安全基线：`lstat` 拒文档级 symlink + `O_NOFOLLOW` fd + `fstat` 身份校验（防 enumerate↔read 间 TOCTOU 换体）。
- **路径规则**：`/` 分隔相对路径；拒绝绝对路径、`..`、NUL、反斜杠；排序固定（目录优先、组内字典序）。
- **预算**：遍历 ≤4 深、≤300 entries、树响应 ≤64KB；单文件读取 ≤256KiB——超限返回前 256KiB + `truncated:true`（不拒读）；二进制一律 typed 拒读，检测在有界读取内完成。
- **symlink 策略（三层）**：顶层技能目录 symlink 允许（与 ccski-symlink-entries 一致，入口层跟进一次）；子目录/文件 symlink 拒绝（typed）；broken link = 可解释 typed omission。Windows reparse point 归入 symlink 类处理。
- **conflict 语义**：SKILL.md 与 .SKILL.md 并存时文件树两份都展示，非激活份标记 disabled；不静默择一。
- **typed errors**：`NOT_FOUND | UNAVAILABLE | INVALID_PATH | BINARY | TOO_LARGE(树超限) | TRUNCATED(内容截断)`，客户端不解析字符串。
- 语言标签 = 客户端扩展名映射，不进契约。

## Δ3 SkillDetail 路由（定稿，采 Codex 方案）

- 路由 `/w/:wsId/skills/:providerId/:skillId`——SkillId 是 canonical path digest，只能在 provider target 内解析；detail 永远绑定具体 copy，copies 是展示关系不承担权限/定位。
- load-time 用 WorkspaceId/ProviderId/SkillId 三 schema 收窄；非法身份 redirect 或 typed not-found，禁止组件 fallback 数据掩盖。
- `?from=` 白名单：`{tab,q,p,dup,scroll,sel,file}`，编码后 ≤512 字符，未知/重复键丢弃（不报错），枚举值校验，构建 route 时经状态对象重组、绝不直接拼 href；浏览器原生 back 并存。
- **`?tab=` 直切**：`screen` 参数同版本退役（无兼容策略 §8），manifest zod 字段改名，不做双读；旧 URL 迁移属发布层。批 1 已按此修订。

## Δ4 ccski 对齐（定稿，收窄）

- ccski 本 change **只加 `removeSkills` 安全原语**：受限 skill name（schema 校验）+ 已解析 target root + direct-child containment + lstat/symlink 策略 + 幂等 typed per-item status；可选 expected content-hash/inode guard 防 check-then-delete 换体。
- `installSkillDir` 同步审计加固（name/path containment、源目录 symlink、部分覆盖与失败恢复）——避免只有 remove 安全的不对称原语。
- **update check 留宿主**（Registry/probe/GitHub Trees/hash 对比都是宿主资产）；**不做「原子 reinstallSkills」**：跨文件系统 remove+install 非天然原子，维持现状「按 target×skill 顺序 per-item、部分成功保留已完成项」语义；真原子化（staged dir/备份/journal）是后续独立议题。
- lock 事实修正：全局 lock v3 `skillFolderHash`、项目 lock v1 `computedHash`；apply 后仅刷新 daemon 内存 `hashOverlay`，**本 change 不改变第三方 lock 写入策略**（写入者裁决另立）。
- 版本：纯 additive 走 minor；若 overwrite/symlink/lock 语义有变，按 ccski 版本契约 + 跨仓测试定，不以 minor 充当安全证明。宿主侧重新发现/逐字段匹配防线保留不撤。

## Δ5 Agents 规模化（定稿：路径 1 收窄）

- 本 change 只用现有字段（id/label/path/available/writable/skillCount）：紧凑行 + 搜索过滤 + 可写|只读分组 + 计数 + Insights 深链 + 行点击跨 Tab 筛选联动。
- **健康点/finding 短标不做**（现有投影无此数据，做了就是假数据）；`providerHealth` typed projection（freshness/unavailable/error/per-provider counts/finding IDs 语义）= 后续独立 change。
- 行点击（跳转）与行尾展开（如有）必须是两个独立可聚焦操作；30 行不虚拟化为当前验收假设，增长超阈值再窗口化（测量门槛：行 DOM 数/键盘导航/搜索响应）。

## 十个开放问题裁决表

1. name 分组=精确匹配；组单位=name，副本单位=组内 contentHash（仅展示）。→ Δ1
2. detail URL 永远指向具体 provider copy；代表变更不改已有 URL；unavailable copy 置灰不隐藏。→ Δ3
3. conflict 双文件都展示；symlink 三层策略；预算 4 深/300 项/64KB 树/256KiB 文件。→ Δ2
4. `from=` 白名单+限长+枚举校验+状态对象重组；`screen→tab` 同版本直切，发布层迁移。→ Δ3
5. apply 维持顺序 per-item 幂等语义；lock 写入者维持 hashOverlay 现状，第三方 lock 写入另立裁决。→ Δ4
6. ccski 原语为 public SDK 但标注 host-guarded 语义；原语测试归 ccski 仓，集成链测试归宿主仓。→ Δ4
7. Agents 无稳定数据源前只用现有字段（路径 1）。→ Δ5
8. parity：本 change 覆盖 shared contract + RPC + WebUI 同源；MCP/CLI 面暂持平铺列表，漂移记录在案、后续批同步。
9. 详情展示绝对 provider path（本地单用户工具，现有 UI 已展示路径）；frontmatter 内容即 SKILL.md 内容原样；二进制元数据永不（typed 拒读）。
10. 验收含：真实浏览器桌面+窄屏交互、路由冷加载、provider unavailable fixture、symlink/TOCTOU 负例、30+ provider fixture；（更新中断恢复测试随批 5 宿主侧）。

## 批次映射

批 1（chrome，含 tab 直切修订）→ Δ3 部分；批 2 → Δ1+Δ3；批 3 → Δ2；批 4 → Δ5 路径 1；批 5 → Δ4；批 6 → 验收十项。
