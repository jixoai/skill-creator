# Proposal: creator-editor-polish — 编辑器升级与新建草稿校验（工作计划 Ch5）

## Why

file-browser 的正文编辑器仍是 monospace textarea（2026-07-27 立项时显式记录的
妥协：CodeMirror 懒加载留待后续迭代）；new 模式校验只覆盖 directoryName 的
safeParse，name/description 的空值只体现在 Save 禁用，无字段级反馈，用户无从
知道为什么不能保存。

## What Changes

- [x] 正文编辑器升级为 CodeMirror 6（markdown 语法 + basicSetup），经动态
      `import()` 懒加载并 code-split；模块未就绪/加载失败时保留 textarea
      底座（SSR 与弱网不阻塞编辑）。
- [x] new 模式草稿结构化校验：`validateNewDraft(draft)` 纯函数（directoryName
      规则、name/description 非空修剪后判定），Save 禁用理由以字段级行内错误
      呈现；edit 模式行为不变（revision 语义已由服务端契约约束）。
- [x] webui 依赖新增 `codemirror` + `@codemirror/lang-markdown`（v6；仅 webui
      bundle，不进 daemon/发布包）。

## Impact

- webui/src/lib/components/creator/：markdown-editor.svelte（新）+
  file-browser.svelte（接入与校验展示）。
- webui/src/lib/stores/creator-draft.ts：校验纯函数（可单测）。
- webui/package.json：新增两个 devDependencies。
- 无 daemon/RPC/契约变更；无 spec delta（gui-* specs 不描述编辑器实现件）。
