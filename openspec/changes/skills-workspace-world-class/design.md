# Design: skills-workspace-world-class

> world-class-designer 全流程产物（工具内页面升级轨道：单方向，不做多方向发散；
> finish line = 品类标杆的可信 peer）。输入 = /tmp/skills-wc/review.md（37 findings）
>
> - proposal.md。自主裁决以 **[IP]**（implementer preference）标注，待 Owner 批。

## 1. Stage 0 — persona 与故事（验收标准）

Persona 沿用产品级两枚（先例 evaluating-world-class 同款）：

**P1「多项目技能管家」（专家）** / **P2「借 AI 写技能的开发者」（新手）**

故事（不用 UI 词汇；批评环逐条走查）：

- **SW-n1（P2）**：「我这台机器上到底装了些什么技能？」打开 Skills 页零点击得到答案：总量一眼可读、禁用项有醒目标记、点一行看到它是干嘛的。预算：读全景 0 点击。
- **SW-n2（P2）**：「这行上的小标记是什么意思？」不需要教程——标记自带人话解释（「同样内容装在 N 个地方」），点开行即见详情。预算：理解 ≤1 点击。
- **SW-x1（P1）**：「同一份技能装了好几个地方，agent 到底会读到哪份？」按内容分组过滤 → 逐个打开对照启用态与所在位置 → 禁用多余副本。预算：开过滤 1 点击 + 处置单项 ≤2 点击。
- **SW-x2（P1）**：「上游仓库最近有什么新东西？」看源卡片的最近扫描时间与数量 → 进入扫描页**同时看到已有与待装** → 选中装到指定位置。预算：进入 1 点击、对比 0 点击（同屏）、安装 ≤3 点击。
- **SW-x3（P1）**「哪些分析建议在等我拍板？」insights 页待审数一眼可见，逐条看证据（发现内容 + 分析时的版本）再批/拒。预算：进第一条 ≤2 点击。

安全门（故事内预算）：Remove/Import 一律确认闸后（settled，/workspace）；安装目标
显式绑定 ws.provider（安全边界 §5 既有）。

## 2. T0 品类地板 — 本地优先的扩展/技能管理面板

标杆三角：**Raycast Extensions**（发现→安装流）、**VS Code Extensions 侧栏**
（已装管理 + 启停 + 来源可溯）、pnpm 式确定性输出（版本/位置如实呈现，不粉饰）。

拆解 Raycast Extensions（同题：浏览→筛选→装到指定作用域）：

| #   | 它的选择                      | why                     | 裁决                                              |
| --- | ----------------------------- | ----------------------- | ------------------------------------------------- |
| 1   | 列表行 = 图标 + 名 + 一行描述 | 行内密度基准，扫读友好  | **keep**（skills 行已是此形，微调重量）           |
| 2   | 搜索框是第一控件              | 检索是第一动作          | **keep**                                          |
| 3   | 安装目标显式选择（个人/团队） | 作用域歧义前置消解      | **swap** → ws.provider 目标选择（同构问题）       |
| 4   | 详情页大 hero + 截图画廊      | 商店说服语境            | **never**（工具内嵌面板，密度优先）               |
| 5   | 「已安装」徽标内联在列表行    | 已有/新增对照是核心价值 | **keep+升级为本设计记忆点**                       |
| 6   | 卡片网格 + 每卡 icon 按钮组   | 触屏商店语法            | **swap** → 行式索引 + detail 面板（桌面工具语法） |

**品类套路**（全员默认，破一个）：generic dashboard = 顶部统计条 + 均质卡片网格

- 状态用彩色 badge 堆叠。本设计以「**行内状态即真相**」破：每行每像素回答
  「这是什么 / 在哪 / 状态如何」，管理动作退到 detail 与确认闸后，不用统计条堆叠。

## 3. 方向与记忆点

**方向引擎**：Raycast 的「行内状态」语法 × 技能库域语义——列表即索引、状态即
内联、动作即退后。三屏共用同一语法（Skills 行 / Agents 卡 / Repos 源卡都是
「身份 + 位置 + 状态」三段式），dashboard 因此是三个统一设计的屏而非三张钉
在一起的列表（review §1 机会 #2 的根治）。

**记忆点（唯一）**：**「已有 vs 待装」对照**——RepositoryScan 的技能清单里，
已存在于当前 workspace 的条目行内联「已安装」徽标并置灰选择；用户勾选瞬间
就知道纯增量。锚定 SW-x2 的「对比」时刻（现状：扫描页完全看不到已有技能，
FP-04/FD-08）。

**三尺寸总表**：

| 设计项              | ≥1044px（三屏并列）         | 692-1044（两列降档） | <692（单列切换）    |
| ------------------- | --------------------------- | -------------------- | ------------------- |
| Skills 主屏         | span 2-3 + list-detail 并列 | span 2，内部并列     | 单屏 + ?view 栈切换 |
| duplicates 高级过滤 | header 工具位图标           | 同                   | 收进同一下拉        |
| Agents 卡片         | 单列副屏                    | 同                   | 单屏列表            |
| Repos 源卡          | 1fr 列                      | 同                   | 单屏列表            |
| Scan 已装对照       | 清单行内联徽标              | 同                   | 同（行内不占新行）  |
| insights 分区       | Analysis/Proposals 锚点导航 | 同（锚条横滚）       | 同                  |
| /workspace 表格     | 五列表格                    | 收窄                 | **卡片化**（FP-09） |

## 4. 逐屏规格

### 4.1 Skills 屏（skills-screen.svelte）

目标：SW-n1/n2 的全景与自解释；SW-x1 的过滤与处置。

- **duplicates 降级 [IP-O2 待批]**：header「Duplicates only」按钮退役；与
  Search config 同组收进「过滤」下拉（图标按钮 + 菜单：Same content only 开关
  - Search config 入口）。行徽标保留（title = "Same content in N locations"
    语义文案改自解释）。URL `?duplicates=1` 语义不变（truth 不动）。（FD-01/02/15）
- **chips 横滚 affordance**：未滚到底时右侧 mask 收紧 + 末尾露出半枚 chip 的
  裁切暗示（mask 起点从 16px 收到 8px 且右侧裁切半宽 chip）；滚到底后回宽松。
  （FD-06）
- **header 计数权重**：总量数字升为与标题同级视觉（text-sm font-medium，去
  Badge 底改纯文本 + tabular-nums）；loading 态改计数位内联 spinner（IconLoader
  h-3），不再独立占位。（FD-07）
- **补全条区分**：已载名 = 定位图标（IconCrosshair/locate）；未载名 = 搜索
  图标（IconSearch）；title 说明各自行为。（FD-04）
- **Chat 上下文衔接**：detail 面板「Chat about this skill」启动会话后，窄屏
  自动 backToList()；宽屏保留 detail 但 toast「会话已在右侧面板打开」；按钮
  文案不变。（FD-05）
- **焦点恢复加固**：恢复前先 scrollIntoView({block:'center'}) 目标行（虚拟化
  窗口外时先触发滚动再 focus；用 requestAnimationFrame 二帧确认）。（FD-11）
- **Load more 反馈**：点击后按钮区显示「已载入 N 条」瞬时文案 1.5s（或新行
  数 toast）；不自动滚动（避免打断）。（FD-20）
- **行高/clamp**：保持 75px（settled 虚拟化契约）；描述 clamp-2 字号从
  text-xs leading-4 调 leading-[18px] 给两行完整空间，name 行 flex 收紧。
  （FD-24——不动常量，仅行内分配微调）

### 4.2 Agents 屏（agents-screen.svelte）— R-A1 差异化强化

目标：让「位置与健康的索引」独立成立（与 Skills 的内容索引正交）。

- **卡片分区**：主操作区（label + path + 徽标 + 计数，整块可点=筛选联动）与
  次要操作区（View findings 行）以 border-t border-border/50 分隔；次要区改
  右对齐 ghost 样式，消除双主按钮误触。（FD-19）
- **findings 入口语义**：改名「Analysis & proposals」+ 待审 proposals 计数
  徽标（数据取 agent-proposals 投影 store 现有 per-provider 摘要；**不新增
  RPC**——无现成摘要则显示 findings severity 计数）。（FD-09）
- **provider-catalog-dedup 边界**：physicalRoots 投影不在本轮实现；卡片信息
  结构留位（设计不阻塞该 change 落地后的扩展）。

### 4.3 Repos 屏（repos-screen.svelte）

- **最近扫描行加相对时间**（scannedAt → "2h ago"式，与源卡 stale 判定同源
  展示）。（FD-10）
- **新增源表单**：gitUrl 输入即校验 https 前缀（错误内联红字）；label 为空
  或 url 非法时 Add 按钮 disabled；server 错误仍走 addError 回显。（FD-22）

### 4.4 RepositoryScan（RepositoryScan.svelte）— 子路由内修（settled 不翻案）

目标：SW-x2 全程同屏对照 + 状态可恢复。

- **记忆点落地**：扫描清单行已存在于当前 ws 的条目显示「已安装」徽标（内联
  IconCheck + 文案），选择框置灰（checked+disabled）；installResult 汇总区分
  newly installed / overwritten（既有）。（FD-08/FP-04 对照缺口）
- **?session= 进 URL**：repo_* opaque id 写入 search；刷新时校验 session 存活
  （过期 → 显式「扫描已过期，重新扫描」空态，非崩溃）；targets 表单序列化
  sessionStorage（key 含 session id，刷新恢复）。（FP-01）
- **sessionExpired 单一恢复路径**：过期时预览区与安装表单灰态（pointer-events
  none + opacity），banner 唯一 Rescan 主按钮；工具栏 Rescan 改名 Refresh 降
  级为图标按钮。（FP-02）
- **安装结果重组**：failed/skipped 分组前置（失败行显示原因一行），installed
  组可折叠；failed>0 时计数数字红色。（FP-03）
- **面包屑**：顶部 `Repos ‹ {sourceLabel}`（Repos 段可点回 screen=repos）；
  Discover 按钮退役并入面包屑。（FP-04）
- **installing 内联进度**：按钮上方内联条「正在安装 N 个技能到 M 个位置…」
  - spinner；结果区紧邻按钮下方呈现（不依赖滚动寻找）。（FP-13）

### 4.5 IntelligenceView（IntelligenceView.svelte）— R-I1+R-I2

- **路由改名 [IP]**：`intelligence/:providerId` → `insights/:providerId`
  （manifest.ts pattern + id `workspaces.insights` + 全部 goById 调用点 +
  dashboard-manifest.test.ts 同步）。
- **?skill= 上下文 [IP]**：可选参数；从技能详情 Insights 按钮跳转携带，页内
  findings 列表预过滤该 skill + 顶部「正在查看：{skill} × 清除」chip。
  （FP-05）
- **两区锚点分区**：页顶锚条（Analysis · Proposals 两链接 + 待审数徽标）；
  Analysis 区 = severity 摘要 + findings 列表 + 关系图；Proposals 区 = 审批
  队列（可按 finding 分组过滤）。同页滚动锚点，不拆路由。（FP-06）
- **severity 空态区分**：过滤中空 =「当前筛选下无结果（Severity: error）+
  清除筛选」；全空 = 现有 no findings 文案。（FP-07）
- **术语清理**：kind → 用户动词（Edit skill/Disable skill/…）；capability
  名降 tooltip；siDraft 角标 →「草稿」/「Draft」；observedRevision →
  「分析版本」+ 相对时间 + stale 前置提示（「此建议基于较旧版本分析」）。
  （FP-08/FP-12）

### 4.6 WorkspaceManager（WorkspaceManager.svelte）

- **窄屏卡片化（P0）**：<720px 表格退役 → 每工作区一张卡（label/missing 状态/
  path/计数/Open/Remove 全可见；Remove 触达 ≥44px 带文字）。（FP-09）
- **删宽屏重复 path 列**：path 只在身份列内嵌（title 全路径）。（FP-10）
- **missing 降 amber + 行级 Refresh**：amber 色系 + Refresh 按钮（重发
  workspace.list 刷新 available）。（FP-11）

### 4.7 壳（SkillsDashboard.svelte）

- **深链滚动 reduced-motion**：matchMedia('(prefers-reduced-motion: reduce)')
  时 behavior:'auto'。（FD-17）
- **切换器 ARIA**：role=tablist/tab → nav + aria-current（导航语义，非 tab
  面板语义）。[IP-FD-23]（FD-23）

### 4.8 Footer + 代码内务

- librarySnapshot 死分支删除（wsId prop 收敛为必需 "~"）。（FD-21）
- skills-screen 组件层重连补救段删除（store connection generation 门控已覆
  盖；保留 error 态 retry 按钮）。（FD-14）

## 5. 减法清单（T6）

| 删/降                                                 | 理由（persona）                              |
| ----------------------------------------------------- | -------------------------------------------- |
| duplicates header 按钮 → 过滤下拉                     | SW-n1 全景不被低频开关干扰；SW-x1 深入口保留 |
| WorkspaceManager path 双列 → 单列                     | 同一信息两次呈现 = 噪音（SW-x3 顺访者）      |
| footer librarySnapshot 死分支                         | 无调用方代码（维护者）                       |
| skills-screen 重连补救段                              | store 门控重复（维护者）                     |
| Scan Discover 按钮 → 面包屑                           | 同一意图两个入口（SW-x2）                    |
| sessionExpired 双 Rescan → 单一                       | 恢复路径必须唯一（SW-x2）                    |
| insights 术语四面（kind/capability/siDraft/revision） | 概念洁癖（SW-x3 无需协议词）                 |

新增元素全表：过滤下拉（1）、补全条二态图标（2）、已安装徽标（1）、锚条
（1）、相对时间（复用行）、Refresh 行按钮（1）——每个均有上文故事背书，
无新增浮层（既有 ConfirmDialog/toast 语义复用）。

## 6. AI-tell 自查（T7）

1. 无新增统计条/仪表卡/环形进度——品类套路的直接规避（T0 裁决 6）。
2. 无渐变、无 emoji、无「New!」类徽章；色彩语义仅 status（amber=禁用/缺失、
   destructive=危险动作、primary=选中/主操作）。
3. 每行/卡一个主操作，次操作灰阶退后——不出现每卡三 icon 按钮组。
4. 数字纪律：每屏 ≤2 种数字语义（settled 延伸；本设计新增计数全部并入既有
   语义位）。
5. 「已安装」徽标用中性 check 图标非彩色 badge——状态内联不做彩色堆叠。
