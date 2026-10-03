<script lang="ts">
  import { useParams } from "$lib/shell";

  const params = useParams<{ wsId: string }>();
  const workspaceId = $derived(params?.()?.wsId ?? "~");
</script>

<section class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
  <h1 class="text-base font-semibold">Evaluating</h1>
  <p class="max-w-md text-sm text-muted-foreground">
    Per-skill evaluation dashboard is being prepared for {workspaceId}.
  </p>
</section>
