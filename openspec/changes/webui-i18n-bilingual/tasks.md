# Tasks: webui-i18n-bilingual

## 1. 基建

- [x] 1.1 DevicePrefs `language` 字段最小扩展（schema + 默认值 + DEFAULT 常量），
      不动其他字段；`shell/__tests__` 补 language 读写用例
      （`pnpm exec vp test run webui/src/lib/shell/__tests__`）
- [x] 1.2 `webui/src/lib/i18n/` 基建：catalogs/en.ts + catalogs/zh.ts +
      locale.svelte.ts（$state locale、DevicePrefs 持久化、document.lang 同步）+ index.ts 公共 API；文件意图头齐全
- [x] 1.3 i18n 单测：插值 / locale 持久化 / document.lang 同步 / en-zh key
      集合相等（`pnpm exec vp test run webui/src/lib/i18n`；9/9 绿）

## 2. A 类适配（每文件迁移后跑该文件聚焦测试）

- [x] 2.1 `apps/wiki/WikiHome.svelte`（14 key）→ wiki-home 测试 3/3 绿
- [x] 2.2 `apps/wiki/WikiScopeView.svelte`（62 key，蒸馏六态 + 失败七因 +
      幂等 toast）→ wiki-scope-view 5/5 + wiki-scope-distill.dom 5/5 绿
- [x] 2.3 `components/toast-container.svelte`（1 key）
- [x] 2.4 `components/command-palette.svelte`（13 key）→
      command-palette-search 2/2 绿
- [x] 2.5 `components/agent/AgentPanel.svelte` + `AgentHeader.svelte` +
      `AgentCard.svelte`（14 key；AgentPanel 增 data-agent-panel 稳定锚点）→
      agent-card-disconnected 3/3 + agent-panel-resize 9/9 + agent-new-session
      13/13 绿
- [x] 2.6 `components/agent/AgentApprovalCard.svelte` +
      `AgentProposalCard.svelte` + `AgentToolRow.svelte`（22 key；module 函数
      直调 t）→ agent-tool-row 22/22 绿
- [x] 2.7 `components/agent/TodoDock.svelte` + `QueueDock.svelte` +
      `ContextMeter.svelte`（30 key）→ queue-dock + context-meter 13/13 绿
- [x] 2.8 `components/agent/ComposerCard.svelte` + `composer-keymap.ts` +
      `SlashMenu.svelte`（50 key；SLASH_COMMANDS.description → descriptionKey）→
      composer-affordances / slash-menu / composer-keymap / agent-busy-enter /
      composer-model-chip / agent-composer-tracks / agent-panel-draft 21/21+18/18 绿
- [x] 2.9 `components/agent/TranscriptView.svelte`（19 key；编辑聚焦选择器改
      data-agent-panel，locale 无关）→ agent-panel + agent-frame-payload 37/37 绿
- [x] 2.10 `components/agent/SkillMenu.svelte` + `ReferenceMenu.svelte` +
      `DropOverlay.svelte` + `DisclosureRow.svelte` + `ChipPaintLayer.svelte`
      （23 key；SkillMenu 空态占位 en 固定现网中文值）→ skill-menu /
      reference-menu / composer-paint / composer-chips 33/33 绿

## 3. 盘点与门禁

- [x] 3.1 `inventory.md`：A/B/C/TBD/SKIP 全量分类 + 计数 + B 类 IA 检查点
- [x] 3.2 全量 webui 测试绿（60 文件 506 测试）+ `pnpm --dir webui check` 绿
      （0 errors 0 warnings，含 zh catalog 类型齐全性门禁）+ 显式文件 fmt
- [x] 3.3 聚焦验证后汇总：en 词典与测试锚点逐字一致的自查记录（per-file 测试
      输出全绿；A 类文件 grep 无残留裸文案字面量）

## 4. IA 后批任务（本轮不做，占位防丢）

- [ ] 4.1 B 类面接入（shell / workspaces / creator / repository / settings
      manifest / eval-view / import-workspace-dialog 等 IA 落定后按 design §6
      约定迁移；检查点见 inventory）
- [ ] 4.2 语言切换 UI（Settings → General segmented control；IA settings
      tab 化落定后）
- [ ] 4.3 SettingsPage / components/settings/** 文案词典化（A-deferred，
      边界裁决见 design §1）
- [ ] 4.4 C 类新面出生即 i18n（dashboard / SkillsAgentPage / evaluating /
      terminal / omnibox）
- [ ] 4.5 daemon 侧错误消息翻译（错误透传面，独立批任务）
