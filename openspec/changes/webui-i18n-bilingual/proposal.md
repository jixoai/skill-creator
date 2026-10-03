# Proposal: webui-i18n-bilingual — WebUI 中英双语基建 + A 类面适配

## Why

Owner 裁决（2026-10-03）：WebUI 做中英双语（i18n）。与并行立项的大型 IA 重构
（workspace 平行化：tab 栏 + 地址栏 + dashboard + Creator AgentChat 化 + evaluating
入口）按三线协同策略异步推进：

> 「有些页面和组件我们是不用改动的，你可以先开始多语言的适配。有些页面和组件
> 要改，改完后也可以开始多语言的适配，有些页面和组件是新增的，一开始就做多语言
> 的适配。这样协同异步同时推进效率是最高的。」

本 change 是三线中的第一线：i18n 基建 + A 类面（IA 不改动面）适配。B 类面
（IA 将重构的页面）本轮禁改文案结构，等 IA 落定后按本基建的既有约定接入；
C 类面（IA 新增面）出生即消费本基建。

## What Changes

- **i18n 基建**（`webui/src/lib/i18n/`）：自研 typed message catalog（零依赖，
  选型对比见 design）——en 为 key 事实源，zh 以 `Record<MessageKey, string>`
  编译期强制齐全；`t(key, params?)` 消费（Svelte 5 runes，模板内动态切换不
  刷新）；locale store 默认 `en`，`DevicePrefs.language` 持久化；
  `document.documentElement.lang` 运行时同步（不改 app.html）。
- **DevicePrefs v1 最小扩展**：新增 `language: z.enum(["en","zh"]).default("en")`
  （带默认值，旧 v1 存量 safeParse 直接通过，无版本迁移——符合既有 schema
  演进方式）。
- **A 类面适配**（本轮落地）：wiki app 两个视图、agent 面板全家
  （components/agent/**）、toast-container、command-palette；可见文本、
  aria-label、title、placeholder 全量迁入词典（en 原文逐字保留——测试与
  冒烟锚点依赖；zh 按 `i18n.zh.md` 领域词汇表翻译）。
- **使用约定**（design §6）：B/C 类后续接入的 key 命名、复数分支、插值、
  测试锚点固定 en 值等规则。
- **盘点表**（`inventory.md`）：全部用户可见文案面的 A/B/C/TBD/SKIP 分类 +
  计数；B 类列出等待 IA 完成的检查点。

## Impact

- **安全不变量**：零影响。i18n 是纯 WebUI 表现层；不触碰 RPC 契约、opaque ID、
  路径解析或 daemon 边界。DevicePrefs 仍是「设备偏好专用 localStorage」，
  language 属设备偏好（同 theme/sidebarCollapsed 先例），不违反状态分层原则。
- **契约层**：零变更。不改 `src/shared/contracts/`、`rpc-contract.ts`。
- **测试**：en 词典值与现网英文逐字一致（含 web-mode-smoke 的
  `skills across \d+ agent locations` 锚点所在 WorkspacesHome——B 类本轮不动），
  既有组件测试不断；新增 i18n 基建单测（插值、locale 持久化、html lang 同步、
  en/zh key 齐全性）。
- **依赖**：零新增运行时/构建依赖（自研方案）；webui package.json 不变。
- **并行 change 协调**：凡 IA 重构清单内文件（shell、workspaces app、creator
  app、repository app、settings manifest、eval-view、import-workspace-dialog）
  本轮一律不改；语言切换 UI 入口（Settings General 分区）因 settings 面
  tab 化未落定，本轮只交 store API，UI 入口留待 IA 后批任务。
