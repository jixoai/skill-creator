# Proposal: docs-archive-hygiene — 文档与归档卫生清场（工作计划 Ch7）

## Why

codex r2/r3 点名的卫生债：三个主 spec 的 Purpose 仍是归档时生成的占位文本
（`openspec validate --all --strict` 3/21 失败全因此）；creator manifest 残留
「视图组件后续 change 5 填充」的过期妥协声明；两处归档 change 存在未勾 tasks。

## What Changes

- [x] `@jixoai-search` / `gui-wiki` / `skill-wiki` 三个 Purpose 重写为真实意图
      （21/21 全绿，本轮已落）。
- [x] creator/manifest.ts 头部过期妥协声明移除（视图早已存在）。
- [ ] 归档未勾 tasks 的处置注记（归档是冻结历史不改原文，处置记录在本
      change）：
      - `archive/2026-09-16-composer-references-queue-actions/tasks.md` 1.9
        （引用链测试）：现状由 `test/agent-references.test.ts` + webui
        `agent-panel.test.ts`（references wire 断言）+ 本轮 Ch2 的 A5 矩阵
        共同覆盖——债务视为已清偿，证据即上述测试文件。
      - `archive/2026-09-14-redesign-model-tabs-and-agent-panel/tasks.md`
        5.2（codex R3 打分）/5.3（全量门禁）：后续会话已完成多轮 codex
        复核与全量门禁运行（本轮 cli-surface-parity 即全量 1610/1610 +
        full build）；视为已清偿，不回写冻结历史。

## Impact

纯文档/注释；零代码行为变更；specs 校验 21/21。
