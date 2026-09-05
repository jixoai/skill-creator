<script lang="ts">
  /**
   * 正交意图：[1] 将根路由无历史污染地转入默认 App（Workspaces）。
   */
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  onMount(() => {
    goto("/workspaces", { replaceState: true });
  });
</script>

<div class="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
  Opening Skill Creator…
</div>
