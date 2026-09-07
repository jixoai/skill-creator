<!--
用户原始需求（2026-09-06）：通过 OpenSpec changes 与 ZCode 交接；AgentLoop 持续迭代；以 DSH 为 Agent 开发基础，合并 Agent 配置/交互面板，提供技能分析、禁用、优化、拆分、合并；产品级应用而非 DEMO。
用户原始需求（2026-09-08，方向修正）：「在现有 skill creator 的基础上实现一个 Agent 的产品……我需要的是 DSH 的内核」，「把整个 skill creator 的各种能力内置成 MCP 和 MCP-apps，给到聊天对话框」；不采用 DSH 完整 WebUI 作产品宿主。锚定既有原文（2026-09-05）：「管理器首先得是管理器，然后接入 Agent 能力」。
意图：1. 固定目标和任务归属；2. 固定开发复核循环；3. 固定完成证据。
-->

# Skill Creator Delivery Goal

你是 ZCode 主负责人。执行本仓五个 active changes，交付可安装、可运行、可恢复的本地技能管理器和专属 Skill Steward。产品代码由你实现；不要把规划完成、编译成功、fixture 或 unavailable 截图当作产品完成。

## Product Contract

```text
Skill Creator = Manager authority + Skill Intelligence + Skill Steward
DSH          = headless agent kernel (dsh-base rows: agent/session/llm/
                settings/sandbox/approval/permission/tools)
Product UI   = Skill Creator shell (ChromeTabs 三 App + OpenTray 窗口)
               + in-shell Agent panel（对话流/工具行/审批/配置）
Capabilities = capability-core（单一声明层）
               -> kernel tools（内置面板会话） + MCP tools/resources（外部）
Agent action = snapshot -> evidence -> proposal -> validation
              -> human approval -> Manager apply -> audit -> rollback
```

Manager 的 WorkspaceRegistry、路径、revision、启停、安装和写入权不交给 DSH。DSH 只以
内核形态组合（不挂 dsh-web-app/WebUI，不复制其 store），版本锁定矩阵与 heal 镜像保留。
Agent 面板是 Skill Creator shell 内的自研组件；能力以 capability-core 双投影（kernel
tools + MCP server）供给，MCP 面 mutation 一律产 proposal 走审批。具体决策见
`openspec/changes/dsh-kernel-rebase/design.md`（D1 内核范围 / D2 面板形态 / D3 供给）。
Manager-only 恢复可用不代表 Agent 集成完成。

在当前仓库继续开发。保留已有 Manager 服务、CLI、OpenTray、Creator、Repository 和测试；无需另建 skill-creator-next。Codex 后端暂不列入本次完成条件，不为了保留旧 adapter 维护双套产品协议。分享和社交另行规划。

## Observe

每轮完整读取 `~/.agents/AGENTS.md`，参考 `~/.zcode/AGENTS.md`（用户消息 AGETNS.md 是拼写差异），读取当前 change、git status、前一轮证据和 `docs/reviews/2026-09-06-zcode-agent-steward-review.md`。

审查基线为 `65f937a...ba63b41`。四个旧 manager/intelligence/steward changes 的 archive 不能证明本轮目标完成。审查运行中全套 253 项有 2 个 timeout；先定位实际失败，不通过提高 timeout、删测试或把 malformed payload 当路径安全证据来消除红灯。

每次声称一个 change 完成前，先固定当前 commit、工作树和生产路径差异：至少存在与该任务对应的 `src/`、`webui/`、`test/`、package/build 产物或可复现运行证据。只有 `openspec/`、`docs/`、`GOAL.md` 的变化只能证明规划更新，不能勾选 implementation task，也不能作为产品完成报告。

## One Execution Order

| Stage | Section（`openspec/changes/dsh-kernel-rebase/tasks.md`） | 退出证据                                       |
| ----- | -------------------------------------------------------- | ---------------------------------------------- |
| 1     | capability-core 抽取                                     | 行为不变重构，全量回归绿，能力清单差异表       |
| 2     | headless 内核组合                                        | 内核 rows 激活证据、agent.* RPC、binder 回归   |
| 3     | Agent 面板                                               | 1100/680 浏览器证据、组件交互测试、0 JS 错误   |
| 4     | MCP 供给                                                 | MCP 合规冒烟、authority 链、clean-install 可用 |
| 5     | 退役 hosted 形态                                         | 产物无 web-composition 残留、门禁绿            |
| 6     | 产品验收与发布证据                                       | 端到端磁盘验证、clean-install drill、文档同步  |

六个阶段全部完成（2026-09-08）：capability-core（3fb6bb3/d4bce7a）、headless 内核
（0218bdf/408062a/7b33730）、Agent 面板（13a703f）、MCP 供给（9be8001/f21125e/
a388310）、退役 hosted 形态（649a5cc）、验收与证据（端到端 authority 链 +
clean-install drill 内核形态 PASS + 全量门禁绿）。前五个 change
（skill-steward-contracts/runtime、dsh-runtime-integration、dsh-webui-composition、
steward-product-workflow）已归档；其 Manager authority、steward 协议、安全不变量与
测试资产继续有效。宿主化路径（入口桥/island/DSH web 宿主）已按阶段 5 退役。

## Decide And Act

每次取一个 checkbox。若任务跨 contracts/service/UI，进一步拆成一个明确输入输出、一个失败案例和一个验收命令的小步，在任务下记录后再开发。GLM-5.3 负责领域状态/集成；Flash 可承担明确的组件装配、fixtures 和文档，不单独决定授权、事务、生命周期或 DSH 接口。

任务报告固定字段：任务 ID、输入/输出、修改文件、复现命令、expected/actual、未验证项、下一步。遇到失败先查根因，最多两次相同尝试；第三次必须改诊断手段或提交具体证据给独立 reviewer，禁止空转。

同一物理文件只有一位 writer；主 Agent 负责整合和真实调用链检查。禁止在任务中猜 API：先看锁定 DSH exports、types、实例测试，再实现；记录实际加载 plugin graph。不要复制私有 DSH store 或重新包装一个只有同名字段的假 runtime。

## Review Loop

本任务明确安排 RemixCode：阶段 1 契约、阶段 2 事务/生命周期、阶段 4 UI composition 和阶段 5 最终交付，均由 ZCode 通过 Herdr 调用独立 Codex `gpt-5.6-terra` + `xhigh` 复核。遵守 `~/.zcode/AGENTS.md` 的创建、异步等待和回收流程；只操作本次创建的资源，不并行堆叠重量级验证。

reviewer 必须读取当前真实 diff、用户目标、change 和可复现证据；输出 P1/P2、0-10 分、对应任务、修复建议和明确通过/不通过。提供自评只能作导航，不能充当事实源。修复后针对 findings 再复核，分数上升不替代未满足的需求。每轮记录 reviewer 遇到的规范歧义和主 Agent 的改进。

普通工程选择自行推进；只有真实凭证/外部访问缺失或无法调和的产品决策才向人报告。等待凭证时先完成确定性 DSH package tests、UI 和打包；不得自动跳过最终真实模型验收。不得擅自 commit、push、发布、删除用户数据或修改用户原有 DSH profile。

## Verify And Record

每小步运行相关测试；每个阶段结束串行执行完整门禁，记录退出码和失败用例。不得并发运行多套测试/构建。

```bash
pnpm test
pnpm typecheck
pnpm --dir webui check
pnpm build
pnpm exec vp fmt --check
git diff --check
openspec validate --all --strict
```

新增 package 的 typecheck/build/test 必须接入根脚本，不能因根脚本未包含 DSH plugin 而得到假绿。真实 daemon 测试隔离 SKILL_CREATOR_HOME、OPENTRAY_HOME、DSH_HOME，默认禁用 tray；native 验收另用受控实例。产物不得引用本地 link:../ccski、/tmp、开发源码路径或 fixture。检查 pack 中的依赖与真实安装，不仅 npm pack --dry-run。

每个 change 的 `artifacts/verification.md` 记录命令、测试结果、脱敏版本/插件图、必要截图以及责任矩阵；只勾有实际证据的 tasks。正文、resource tree、启停配置和 journal 的前后状态是 mutation 证据，toast 和 transcript 不能替代。

`skill-steward-contracts/demo/contracts-reference.html` 和 `skill-steward-runtime/demo/fixture-workflow.html` 仅供阅读结构与状态参考，未作为真实 DSH/browser 验收；不得复制其中的模拟状态、静态按钮或样式作为上线实现。最终交互由阶段 5 的真实组件、测试和浏览器操作验收。

## Completion Audit

以下全部成立才可报告本轮开发完成：

- 干净目录安装生产包，CLI start/status/openinbrowser/stop/restart 可运行；Manager 不依赖 DSH 或模型服务在线；socket、crash、插件失败均可恢复。
- Manager 原有导入、发现、查看、启停、创建/编辑/删除、pinned Repository 预览安装与更新均无回归。
- 同一产品 shell 中使用实际 DSH Agent 配置、session 与交互组件，Manager views 保留；无 iframe/双 Agent shell，凭证脱敏，重连保留路由和 dirty draft。
- 单 skill 和多 skill 的分析都能展示 evidence/关系；模型推断标明不确定性；未调用不等于无用，字数降低不等于效果提高。
- edit/disable/split/merge 均从实际 DSH tool calls 形成方案，经 validation、人类 approval、apply、audit 和 rollback；资源映射、启停恢复、revision 冲突及补偿失败已测试。
- Agent 不具备 approve、通用 shell/文件写工具；不存在 validate 自动授权、自然语言 JSON 驱动 mutation、重启重放旧 grant。
- fixture 用于确定性失败验证；另有真实模型完整维护 run、promptVersion/toolVersion/DSH version 和前后质量样例证据。只有 unavailable 测试不算完成。
- 全量检查通过、浏览器 1100px/680px 实际交互通过、P1/P2 全关闭、独立 Codex 最终复核通过，无隐瞒的未验证项。

完成后再同步主 specs、按阶段 archive，更新 AGENTS.md 的“当前事实”与 i18n.zh.md；不要提前把目标架构写成已运行事实。向用户提交可审查结果并等待其安排发布。产品开发的完成条件不会因上下文压缩、预算、截图或编译绿灯而缩小。
