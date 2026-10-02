# Tasks: ux-polish-walkthrough-residue

- [x] 1.1 render-skill-md：`parseFrontmatterBlock` 补块标量（`>`/`|` × clip/
      strip/keep chomping），详情 header 草稿与 Frontmatter 表不再显示 `>-` 原文
- [x] 1.2 聚焦测试：`webui/src/lib/__tests__/render-skill-md.test.ts` 追加
      folded/literal/chomping/段落分隔/块后继键/空块/keep 用例 →
      `pnpm exec vp test run webui/src/lib/__tests__/render-skill-md.test.ts`
      19/19 passed（原 11 例 + 8 新例）
- [x] 2.1 layout.css：light `--muted-foreground` 0.556 → 0.46（dark 0.708 不动）。
      WCAG 核算（灰轴 oklch L 的相对亮度 = L³）：0.46³=0.0973，对 `--background`
      (1³=1.0) = 1.05/0.1473 = 7.13:1；对 `--muted` (0.97³=0.9127) =
      0.9627/0.1473 = 6.53:1；对 `--secondary` (0.967³) = 6.48:1——全部 ≥4.5:1
      （旧值 0.556 对 white 4.73:1，叠加 /80 透明度用法后 ≈3.2:1，与走查实测
      ≈3.6 同族）；dark 0.708 对 0.145 背景 = 7.63:1 复核不变
- [x] 3.1 Agent 面板 7 处小命中区扩到 ≥24px（视觉尺寸不变，`after:-inset`
      外扩，沿用 QueueDock/AgentHeader 先例）：TranscriptView 消息操作条
      h-5(20px)+inset-1 → 28px ×4；ComposerCard 附件移除钮 h-4(16px)+inset-1 →
      24px；ComposerCard 文件芯片移除钮（裸 ×）h-4+inset-1 → 24px；AgentPanel
      edit-note 取消钮 (~14px)+inset-1.5 → 26px
- [x] 4.1 GeneralSettingsSection：Theme 行 `flex-wrap gap-2` + 分段控件
      `max-w-full flex-wrap`（窄容器先整组换行、极窄时分段换行，System 段不再被
      overflow-hidden 裁切）；未选中段显式 `bg-transparent`，仅选中态保留
      `bg-accent`
- [x] 5.1 curated-sources.ts 两条描述改英文（"The official collection of Agent
      skills maintained by Anthropic." / "Community Agent skills maintained by
      Vercel Labs."）；source-card "Home" → "Open repo"（homepage 恒为 GitHub
      仓库页；aria-label 同步）。回归：`test/curated-sources.test.ts` 5/5 passed
      （无中文文案断言）
- [x] 6.1 IntelligenceView：节点数 >24（DENSE_LABEL_THRESHOLD）时默认只渲染
      hover 节点标签（`onpointerenter/leave` 驱动 `hoveredSkillId`），稀疏图
      照旧全显；`<title>` 全名提示保留；图注追加 "Dense graph — hover a node
      to reveal its label."
- [x] 6.2 顺带清除 IntelligenceView 内已无调用的 `splitDocument` 死代码（与
      #1 同口径的历史残留，避免下一位读者误以为它仍参与解析）
- [x] 7.1 workspace-targets `workspaceEntryPath`：优先第一个 `skillCount > 0`
      的 provider（全空维持首个；无 provider/global 回 home 不变）。新测
      `workspace-entry-landing.test.ts`（stores 测试目录）5 例：跳空落非空 /
      全空维持首个 / 首个即非空 / 无 provider / global 不深链；既有
      `workbench-focused.test.ts` 9 例回归 → 全绿
- [x] G.1 门禁：`pnpm typecheck` exit 0；`pnpm --dir webui check` 0 errors
      0 warnings；聚焦测试 4 文件 38/38 passed（render-skill-md 19 +
      workspace-entry-landing 5 + workbench-focused 9 + curated-sources 5）；
      触碰文件逐一 `pnpm exec vp fmt`；openspec strict 校验（validate
      ux-polish-walkthrough-residue --strict）valid

## codex WS5 复核记录（8.5/10，可归档；P2 处置 956a9f5）

- 已修（956a9f5）：折叠标量连续空行 N 换行（标准 yaml 实证 + 前导空行同类偏差）；
  AgentCard $effect 裸调 requireRpc 同族逃逸（连接闸 + 就绪重发 + 回归）；
  evaluation comparator 相等键返 0。
- **只记录不修（后续批候选）**：`text-muted-foreground/80`、`/70` 透明度用法实测
  ≈4.33:1 / 3.45:1 低于 WCAG AA 4.5:1——需独立 change 全量专项清理（统一降透明档
  或改实色 token）；evaluation 结果 `endedAt` 建议 schema 层约束 ISO 8601（当前
  普通 string，排序语义靠约定）。
- vision 复验：深链 eval 10/10 真实冷加载零报错；非零 errors 红分支留待有真实
  finding 语料顺带抽查。
