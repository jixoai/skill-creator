# Tasks: creator-editor-polish

- [x] 1. CodeMirror 懒加载编辑器（markdown-editor.svelte：动态 import、
      textarea 底座回退、外部值同步无回环、SSR 安全）
- [x] 2. file-browser 正文区接入 markdown-editor（草稿 body 双向绑定；其余
      表单不动）
- [x] 3. validateNewDraft 纯函数 + 字段级行内错误 + Save 禁用联动
- [x] 4. 门禁：focused webui tests + `pnpm --dir webui check` + typecheck +
      fmt + full build

## 验收证据

- 懒加载：构建产物 CodeMirror 全部落在独立 chunk（VnziGBZO/BBIMLD1J/CYhuNS_d，
  主 node/entry bundle 零 cm-editor 字样）；textarea 底座在模块未就绪/失败时兜底。
- 校验：`webui/src/lib/stores/__tests__/creator-draft-validation.test.ts` 4/4
  （空草稿全错 / 空白修剪 / 目录名规则 / edit 恒通过）。
- 门禁：typecheck 0、svelte-check 0 errors、vp fmt --check 0、pnpm build 0。
