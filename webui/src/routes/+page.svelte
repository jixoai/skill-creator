<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)」。
   * 正交意图：[1] 将根路由无历史污染地转入默认 workspace。
   */
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  onMount(() => {
    goto("/workspace/~/", { replaceState: true });
  });
</script>

<div class="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
  Opening workspace…
</div>
