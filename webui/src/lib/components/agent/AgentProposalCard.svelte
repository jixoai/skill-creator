<!--
  用户原始需求 [2026-09-08]（tasks 4.4）：「MCP 面 mutation 一律产 proposal 待审批
  （不直接写盘），审计链完整」——面板是 Manager authority 的决定面。
  正交意图：
  1. pending proposal 的审批卡：capability + 输入摘要 + Approve/Reject（经
     agent.proposals.*；结果态降级只读）。
  妥协声明：无。
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { requireRpc } from "$lib/stores/connection.svelte";
  import { showToast } from "$lib/toast.svelte";

  let {
    proposalId,
    capability,
    input,
    status,
  }: {
    proposalId: string;
    capability: string;
    input: unknown;
    status: string;
  } = $props();

  let deciding = $state(false);
  /** 本地决定态（决定后覆盖外部投影；未决定时跟随传入 status）。 */
  let decided = $state<string | null>(null);
  const currentStatus = $derived(decided ?? status);

  const inputText = $derived.by(() => {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  });

  async function decide(decision: "approve" | "reject"): Promise<void> {
    deciding = true;
    try {
      const rpc = requireRpc();
      const result =
        decision === "approve"
          ? await rpc.agent.proposals.approve({ proposalId })
          : await rpc.agent.proposals.reject({ proposalId });
      decided = result.proposal.status;
      showToast(
        decision === "approve"
          ? currentStatus === "executed"
            ? `Proposal executed: ${capability}`
            : `Proposal failed: ${capability}`
          : `Proposal rejected: ${capability}`,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      deciding = false;
    }
  }
</script>

<div
  class="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs"
  role="group"
  aria-label="Mutation proposal"
>
  <div class="mb-1.5 flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
    Proposal — {currentStatus}
  </div>
  <div class="font-mono text-[11px]">{capability}</div>
  <pre
    class="mt-1 max-h-32 overflow-auto rounded bg-muted/40 p-1.5 font-mono text-[10px] whitespace-pre-wrap">{inputText}</pre>
  {#if currentStatus === "pending"}
    <div class="mt-2 flex justify-end gap-1.5">
      <Button size="sm" variant="outline" disabled={deciding} onclick={() => void decide("reject")}>
        Reject
      </Button>
      <Button size="sm" disabled={deciding} onclick={() => void decide("approve")}>Approve</Button>
    </div>
  {/if}
</div>
