# Design: evaluating-world-class

> world-class-designer 全流程产物。Stage 0 先于一切；T0 定品类地板；单方向
> （工具内页面，非独立产品线——不做多方向发散，做「品类最佳的可信 Peer」）。

## 1. Stage 0 — persona 与故事（验收标准）

Persona 沿用产品级两枚（不为本页新造）：

**P1「多项目技能管家」（专家）**——evaluating 的主用户。
**P2「借 AI 写技能的开发者」（新手）**——Creator 引导链的下游。

故事（不用 UI 词汇；后续批评环逐条走查）：

- **E-novice（P2）**：「这个技能到底靠不靠谱？」——打开 Evaluating，扫一眼就
  得到答案：绿了几个、红了几个、上次测是什么时候。全程不需要懂「语料/断言/
  绑定版本」这些词；哪里红了点进去，能看到「当时它说了什么 vs 我期望它说什么」。
- **E-expert（P1）**：某个断言「应该触发却没触发」——两步内看到失败断言的期望
  与观测对照 + 当时绑定的 revision；技能改版后旧结果有醒目的过期标记；从这里
  直接再跑一轮，跑的时候能看到进行到第几个 case。

交互预算：novice 主路径（打开→读懂健康度）0 点击；expert 目标（进入→失败断言
对照）≤2 点击；再跑一轮 ≤3 点击。

## 2. T0 品类地板 — 评估/测试报告

品类：**CI/测试报告界面**（工具内嵌面板形态）。标杆三角：GitHub Actions run
视图（canonical）、Playwright HTML report、Linear Cycles（进度语言）。

**拆解 GitHub Actions run 视图**（选它因为它解决的是同一问题：一屏判断
「坏了没有、坏在哪」）：

| # | 它的选择 | why | 裁决 |
| --- | --- | --- | --- |
| 1 | run 列表=状态 icon（✓✕●）+ 时长 + 相对时间 | 三态瞬时判读 | **keep**（绿/红/灰三态是品类肌肉记忆） |
| 2 | job→步骤树，失败步骤红且默认展开、成功折叠 | 注意力=失败处 | **keep**（case 树失败自动展开） |
| 3 | 失败日志内联展开（不跳页） | 诊断上下文不丢 | **keep**（断言详情内联） |
| 4 | commit 元数据贯穿（sha/branch/author） | CI 语境 | **swap**→技能语境（skillName/revision 短显/provider） |
| 5 | 顶部 filter/bar（branch/event 过滤） | 多 run 溯源 | **swap**→run 选择器（时间线，本产品 run 量级小） |
| 6 | 重跑按钮带确认弹层 | 防误触发 | **keep**（Run… 显式确认已有裁决） |
| 7 | 全宽时间线甘特/瀑布 | 耗时归因 | **never**（eval 的 run 无并行 job 概念） |

**品类套路**（全员默认，破一个）：报告页 = 顶部大统计条 + 表格堆叠的 dashboard
generic 味——本设计以「步骤树 + 内联诊断」替代统计条堆叠（统计只在总览卡内）。

## 3. 方向与记忆点

**方向引擎**：GitHub Actions 的「诊断流」语法 × 技能域语义——总览页是「健康度
仪表」（回答 novice 的「靠谱吗」），详情页是「run 报告」（服务 expert 的诊断流）。

**记忆点（唯一）**：**断言级期望 vs 观测 diff 视图**——失败断言展开时，期望与
观测以 diff 双栏呈现（finding 类断言另配触发语义标记：期望触发 ✕ 未触发）。
这锚定 E-novice 故事的「它说了什么 vs 我要它说什么」时刻。

三尺寸：≥1024 树+详情双栏 / 720-1024 树折叠为抽屉 / <720 单列切换（树→详情
push 视图，URL search 携带 caseId）。

## 4. 信息架构与交互规格

### 4.1 总览屏（/w/:wsId/evaluating）

```text
┌ 近期 runs 时间线（横向，最近 20，GitHub Actions run list 式行）
│  ● run 3m ago · 12/15 passed · completed   [Run…]
├ 技能健康卡网格（沿 mobileScreen 网格语言，但卡内为仪表）：
│  ┌────────────────────────┐
│  │ ◔ 87%  vue-helper       │  通过率环（最近 run）+ stale 黄带（有则环绕）
│  │ ✓12 ✕2 ●1 · 3m ago     │  三态计数行 + 相对时间
│  │ failing: should-trigger │  失败摘要一行（最新失败断言名，点入直达）
│  └────────────────────────┘
```

- 卡点击 → 详情屏（`/w/:wsId/evaluating/:providerId/:skillId`）。
- Run… 显式确认（target 三段标注）沿既有裁决；Global 无 Run。
- 空态（无语料）：单焦点引导卡 + 「从 Creator 的 test 环节生成话术」深链
  （衔接 creator 引导链）。

### 4.2 详情屏（run 报告式）

```text
┌ run 选择器（时间线胶囊：最新在前，选中态；运行中带 live 进度 case n/m）
├──────────────┬──────────────────────────────────────────┤
│ case 步骤树   │ 断言详情（选中 case）                       │
│ ✓ case-1 3/3 │ ─ 期望 vs 观测 diff 双栏（记忆点）          │
│ ✕ case-2 1/3 │   finding 类：触发语义标记（✓触发/✕未触发） │
│   └ 红默认展开│ ─ observedEndRevision 短显 + 与当前 revision │
│ ● case-3 …   │   对照（stale 判读）                        │
│ （灰=运行中） │ ─ 断言逐条行（icon + kind + 结果）          │
└──────────────┴──────────────────────────────────────────┘
```

- case 树：状态 icon（三态）+ 断言通过分式徽标；失败 case 默认展开且选中；
  成功折叠；展开态会话内记忆（URL search `?case=` 携带可深链）。
- 键盘：↑↓ 移动 case 选择，Enter/→ 展开，Esc 收起（沿 omnibox 键盘语言）。
- 运行中 run：case 行随 result 到达逐个点亮（status 轮询既有机制），树顶部
  live 进度行；Cancel 沿既有幂等语义。
- case 新建/编辑（Imported-only）收进「管理」折叠区（诊断流优先，编辑次之）。

## 5. 数据映射（契约零新增验证）

- overview：targets（lastRun 四计数 + staleRatio）+ recentRuns → 时间线与卡。
- results.list（per-target）：case 分组最新一条（沿每-case-最新口径）→ 树行 +
  断言详情（result.assertions[] 含 kind/outcome/期望观测字段——实现首日核对
  contracts/evaluation.ts 投影是否含断言级 expected/observed 文本；缺则本
  change 内做最小契约扩展并回填 spec delta）。
- cases.list：enabled/enabledAt + prompt 摘要 → 树行与编辑源。

## 6. 批评环（验收门）

- 实现完成后：新鲜批评者（vision 子代理看截图，锚定 GitHub Actions 报告
  可信 Peer 的质量 bar）逐条走查 E-novice/E-expert 故事 + AI 味扣分项；循环
  至 9+/10 或触发停止条件（Owner 品味/结构级两类残留时收口上报）。
- 回执存 docs/reviews/。

## 7. 非目标

- 不动 daemon run/case 写路径与权限闸（archive 已定）。
- 不做多 run 对比视图（后续批）。
- Agent 页/其它区块的打磨（workspace-page-polish 与 zcode-parity 域）。
