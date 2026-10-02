# Proposal: ux-polish-walkthrough-residue — WS4 走查非阻塞遗留七项收尾

## Why

四轮 ego-browser 走查（收据 `docs/reviews/2026-10-01-ws4-ego-browser-walkthrough.md`，
主视口 1100×680）的阻塞项已全部清偿；本 change 收录同一走查在录的非阻塞 UX 遗留，
避免残影随版本合入长期存续。七项均为小颗粒、可独立验收的展示/交互修复，不改变
任何协议、存储或安全边界。

## What Changes

- [x] 1. YAML 折叠标量显示：webui `splitSkillContent` 最小 YAML 解析器补块标量
      （`>`/`|-` 族 + chomping）——详情 header 草稿与 Frontmatter 表不再显示
      `>-` 原文，与列表行（ccski 服务端口径）一致；不引入 gray-matter（bundle
      妥协声明保留），补聚焦测试。
- [x] 2. 对比度：light `--muted-foreground` oklch(0.556 0 0) → oklch(0.46 0 0)，
      12px 辅助文本对 `--background`/`--muted` 对比度 ≥4.5:1（WCAG 公式核算，
      dark 值 0.708 不动）；全局 token 一次改全站受益。
- [x] 3. Agent 面板小命中区：消息操作条（Copy/Edit/Resend，20px）、附件缩略图
      移除钮（16px）、文件芯片移除钮（~14px）、edit-mode 注记条取消钮（~16px）
      用 `after:-inset` 伪元素扩到 ≥24px 命中区，图标视觉尺寸不变（沿用
      composer-affordances 既有写法）。
- [x] 4. Theme 分段控件（GeneralSettingsSection）：a) 行级 `flex-wrap` + 控件
      `max-w-full flex-wrap`——窄内容区（Agent 面板开启）下 System 段不再被
      `overflow-hidden` 裁切；b) 未选中段显式 `bg-transparent`，仅选中态保留
      `bg-accent` 底色。
- [x] 5. Repository 文案：curated 源描述改英文（UI 语言一致性）；源卡片 "Home"
      按钮按实际行为（打开仓库主页 = GitHub repo）改为 "Open repo"。
- [x] 6. Intelligence graph 密集标签：节点数超过阈值（24）时默认只渲染 hover
      节点的标签（其余悬停显现，`<title>` 全名提示保留），稀疏图照旧全显。
- [x] 7. Workspace 卡默认落点：`workspaceEntryPath` 优先落第一个有技能
      （skillCount>0）的 provider，全空维持第一个；纯函数 + 单测。

## Impact

- 触碰面：`webui/src/lib/render-skill-md.ts`、`webui/src/routes/layout.css`、
  `webui/src/lib/components/agent/{TranscriptView,ComposerCard,AgentPanel}.svelte`、
  `webui/src/lib/components/settings/GeneralSettingsSection.svelte`、
  `webui/src/lib/components/source-card.svelte`、`src/shared/curated-sources.ts`、
  `webui/src/lib/apps/workspaces/IntelligenceView.svelte`、
  `webui/src/lib/stores/workspace-targets.ts` + 对应测试。
- 零协议/存储/安全边界变更；`curated-sources.ts` 描述字段是浏览器安全静态快照，
  改文案无兼容影响（无持久化消费 description 的键）。
- 无 spec delta（skip_specs: true）。
