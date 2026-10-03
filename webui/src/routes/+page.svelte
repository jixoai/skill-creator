<script lang="ts">
  /**
   * 正交意图：[1] 将根路由无历史污染地转入 Global Skills Page。
   */
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  onMount(() => {
    goto("/w/~/skills", { replaceState: true });
  });
</script>

<div class="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
  Opening Skill Creator…
</div>
