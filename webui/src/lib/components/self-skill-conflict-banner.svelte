<!--
  用户原始需求 [2026-09-30]（self-skill-symlink）：「如果发现 ~/.agents/skills/
  skill-creator-v2 的源头不是 git/npm……在 cli 或者 webui 启动之后提醒用户存在
  skill 冲突，给几个选择：覆盖安装我们自己的版本（可选备份原版）；坚持使用用户
  自己已有的版本。」Dock 冷启动向量无 TTY，本 banner 是该场景唯一可见提醒面。
  正交意图：1. 冲突呈现（kind 判别文案 + 条目路径）；2. 裁决动作（覆盖[备份勾选]/
  保留，busy 锁 + toast 终态）。
-->
<script lang="ts">
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { showToast } from "$lib/toast.svelte";
  import {
    keepSelfSkillUserVersion,
    resolveSelfSkillConflict,
    selfSkillState,
  } from "$lib/stores/self-skill.svelte";

  const conflict = $derived(
    selfSkillState.status?.state === "conflict" ? selfSkillState.status.conflict : null,
  );

  let backup = $state(true);
  let installing = $state(false);
  let keeping = $state(false);

  const kindText = $derived.by(() => {
    if (!conflict) return "";
    if (conflict.kind === "user-directory") return "a directory you maintain";
    if (conflict.kind === "foreign-link") {
      return `a link to ${conflict.targetPath ?? "an external location"}`;
    }
    return "a foreign entry";
  });

  async function install(): Promise<void> {
    if (!conflict || installing) return;
    installing = true;
    const result = await resolveSelfSkillConflict(backup && conflict.backupAvailable);
    installing = false;
    if (result.ok) {
      showToast(
        result.backupPath
          ? `Self skill installed; previous version backed up to ${result.backupPath}`
          : "Self skill installed.",
      );
    } else {
      showToast(`Self skill install failed: ${result.reason}`);
    }
  }

  async function keep(): Promise<void> {
    if (!conflict || keeping) return;
    keeping = true;
    const result = await keepSelfSkillUserVersion();
    keeping = false;
    showToast(
      result.ok
        ? "Kept your version; we will remind you again only if the entry changes."
        : `Keep failed: ${result.reason}`,
    );
  }
</script>

{#if conflict}
  <div
    class="mb-4 flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
    role="alert"
  >
    <IconAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
    <div class="min-w-0 flex-1 space-y-2.5">
      <p class="leading-relaxed">
        <span class="font-medium">Self skill conflict.</span>
        <code class="rounded bg-muted px-1 py-0.5 text-xs">{conflict.entryPath}</code>
        is {kindText}, not linked to this Skill Creator install.
      </p>
      {#if conflict.backupAvailable}
        <label class="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox bind:checked={backup} id="self-skill-backup" />
          Back up the existing directory first (<code>~/.agents/skills-backup/…</code>)
        </label>
      {/if}
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" onclick={() => void install()} disabled={installing || keeping}>
          {installing ? "Installing…" : "Install product version"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onclick={() => void keep()}
          disabled={installing || keeping}
        >
          {keeping ? "Keeping…" : "Keep my version"}
        </Button>
      </div>
    </div>
  </div>
{/if}
