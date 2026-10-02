<!--
  测试桩（eval-view-revision-display.test.ts）：以固定 edit 草稿提供
  creator-editor context 并挂载 EvalView——EvalView 经 useCreatorEditor 消费
  context，脱离 CreatorWorkspace 单测时由本 host 兜住。身份为固定测试常量
  （与测试文件的 WS/PROVIDER/SK 一致），无响应式需求。
-->
<script lang="ts">
  import { editDraft, provideCreatorEditor } from "$lib/stores/creator-editor.svelte";
  import EvalView from "$lib/components/creator/eval-view.svelte";
  import type { SkillId, WorkspaceProviderTarget } from "$lib/types";

  const wsId = "ws_0123456789abcdef01234567" as WorkspaceProviderTarget["workspaceId"];
  const providerId = "openclaw" as WorkspaceProviderTarget["providerId"];
  const skillId = "sk_0123456789abcdef01234567" as SkillId;

  provideCreatorEditor(editDraft({ workspaceId: wsId, providerId }, skillId));
</script>

<EvalView />
