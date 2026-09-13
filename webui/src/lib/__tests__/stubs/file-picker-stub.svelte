<!--
  FilePickerDialog 测试桩（R17-B）：真实组件经 ui/dialog → bits-ui（node_modules
  .svelte，root/webui vitest 管线不编译）；挂载 ComposerCard/AgentPanel 的组件
  测试以本空壳替换，弹层交互由 file-picker-dialog.test.ts 直测。
-->
<div data-testid="file-picker-stub" aria-hidden="true"></div>
