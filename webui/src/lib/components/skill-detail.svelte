<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「目的是以人为本，要让小白到各行各业到专业工程师用起来都舒心」。
   * 正交意图：
   * 1. 呈现技能来源、资源与完整正文。
   * 2. 编排校验、编辑与启停操作。
   * 3. 在窄容器中提供带语义焦点的列表/详情往返路径。
   */
  import type { SkillInfo, ValidateResult } from "$lib/types";
  import { formatSize, locationLabel, shortenPath } from "$lib/format";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import IconArrowLeft from "@lucide/svelte/icons/arrow-left";
  import IconCheck from "@lucide/svelte/icons/circle-check";
  import IconCode from "@lucide/svelte/icons/code";
  import IconFile from "@lucide/svelte/icons/file-text";
  import IconFolder from "@lucide/svelte/icons/folder";
  import IconImage from "@lucide/svelte/icons/image";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPencil from "@lucide/svelte/icons/pencil";
  import IconPower from "@lucide/svelte/icons/power";
  import IconShield from "@lucide/svelte/icons/shield-check";

  /** 技能详情及由 workspace 页面提供的操作能力。 */
  let {
    skill,
    headingRef = $bindable(null),
    busy = false,
    editable = false,
    onToggle,
    onEdit,
    onBack,
    onValidate,
  }: {
    skill: SkillInfo | null;
    headingRef?: HTMLHeadingElement | null;
    busy?: boolean;
    editable?: boolean;
    onToggle?: (mode: "enable" | "disable") => void;
    onEdit?: () => void;
    onBack?: () => void;
    onValidate?: () => Promise<ValidateResult | null>;
  } = $props();

  let validating = $state(false);
  let validation = $state<ValidateResult | null>(null);
  let validationError = $state<string | null>(null);
  let validationGeneration = 0;

  $effect(() => {
    void skill?.id;
    validationGeneration += 1;
    validating = false;
    validation = null;
    validationError = null;
  });

  async function validate(): Promise<void> {
    const skillId = skill?.id;
    if (!onValidate || !skillId) return;
    const generation = ++validationGeneration;
    const canCommit = (): boolean => generation === validationGeneration && skill?.id === skillId;
    validating = true;
    validation = null;
    validationError = null;
    try {
      const result = await onValidate();
      if (canCommit() && result) validation = result;
    } catch (error) {
      if (canCommit()) validationError = error instanceof Error ? error.message : String(error);
    } finally {
      if (canCommit()) validating = false;
    }
  }
</script>

{#if !skill}
  <div
    class="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground"
  >
    <IconFile class="h-8 w-8 opacity-50" />
    <p class="text-sm font-medium text-foreground">Select a skill</p>
    <p class="max-w-xs text-xs">
      Inspect its source, validation status, resources, and complete instructions.
    </p>
  </div>
{:else}
  <div class="detail-surface flex h-full min-w-0 flex-col">
    <header class="border-b border-border px-4 py-3">
      <div class="detail-header-layout flex items-start gap-3">
        <button
          class="detail-back mt-0.5 hidden h-8 w-8 items-center justify-center"
          aria-label="Back to skills"
          onclick={onBack}
        >
          <IconArrowLeft class="h-4 w-4" />
        </button>
        <div class="detail-summary min-w-0 flex-1">
          <h2
            bind:this={headingRef}
            class="truncate text-base font-semibold focus:outline-none"
            tabindex="-1"
          >
            {skill.name}
          </h2>
          <p class="mt-0.5 text-xs leading-5 text-muted-foreground">{skill.description}</p>
        </div>
        <div class="detail-actions flex shrink-0 items-center gap-1.5">
          {#if editable}
            <Button variant="ghost" size="sm" class="detail-action h-8 gap-1.5" onclick={onEdit}>
              <IconPencil class="h-3.5 w-3.5" /> Edit
            </Button>
          {/if}
          <Button
            variant="outline"
            size="sm"
            class="detail-action h-8 gap-1.5"
            onclick={validate}
            disabled={validating}
          >
            {#if validating}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconShield
                class="h-3.5 w-3.5"
              />{/if}
            Validate
          </Button>
          <Button
            size="sm"
            variant={skill.disabled ? "default" : "outline"}
            class="detail-action h-8 gap-1.5"
            disabled={busy}
            onclick={() => onToggle?.(skill.disabled ? "enable" : "disable")}
          >
            <IconPower class="h-3.5 w-3.5" />
            {skill.disabled ? "Enable" : "Disable"}
          </Button>
        </div>
      </div>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <Badge variant="secondary">{skill.provider}</Badge>
        <Badge variant="outline">{locationLabel(skill.location)}</Badge>
        <Badge variant="outline">{formatSize(skill.size)}</Badge>
        {#if skill.disabled}<Badge variant="outline" class="text-amber-700 dark:text-amber-300"
            >Disabled</Badge
          >{/if}
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {#if validationError}
        <p class="mb-4 border-b border-destructive/30 pb-3 text-xs text-destructive" role="alert">
          {validationError}
        </p>
      {/if}
      {#if validation}
        <section class="mb-4 border-b border-border pb-3" aria-live="polite">
          <div class="flex items-center gap-2 text-xs font-medium">
            {#if validation.success}<IconCheck class="h-4 w-4 text-emerald-600" /> Valid skill{:else}<IconShield
                class="h-4 w-4 text-destructive"
              /> Validation issues{/if}
          </div>
          {#each validation.errors as issue}<p class="mt-1 text-xs text-destructive">
              {issue}
            </p>{/each}
          {#each validation.warnings as issue}<p
              class="mt-1 text-xs text-amber-700 dark:text-amber-300"
            >
              {issue}
            </p>{/each}
        </section>
      {/if}

      <dl class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
        <dt class="flex items-center gap-1.5 text-muted-foreground">
          <IconFolder class="h-3.5 w-3.5" /> Path
        </dt>
        <dd class="break-all font-mono text-[11px]">{shortenPath(skill.path)}</dd>
        <dt class="text-muted-foreground">Source</dt>
        <dd>{skill.sourceKind ?? skill.location}</dd>
        <dt class="text-muted-foreground">Resources</dt>
        <dd class="flex flex-wrap gap-2">
          <span class="inline-flex items-center gap-1"><IconFile class="h-3 w-3" /> SKILL.md</span>
          {#if skill.hasReferences}<span>references/</span>{/if}
          {#if skill.hasScripts}<span class="inline-flex items-center gap-1"
              ><IconCode class="h-3 w-3" /> scripts/</span
            >{/if}
          {#if skill.hasAssets}<span class="inline-flex items-center gap-1"
              ><IconImage class="h-3 w-3" /> assets/</span
            >{/if}
        </dd>
      </dl>

      <section class="mt-4 border-t border-border pt-3">
        <h3 class="mb-2 text-xs font-medium text-muted-foreground">SKILL.md</h3>
        <pre
          class="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground"><code
            >{skill.content}</code
          ></pre>
      </section>
    </div>
  </div>
{/if}

<style>
  .detail-surface {
    container-type: inline-size;
  }

  @container (max-width: 520px) {
    .detail-header-layout {
      flex-wrap: wrap;
    }
    .detail-summary {
      min-width: 0;
    }
    .detail-actions {
      width: 100%;
      padding-left: 2.75rem;
    }
    .detail-back {
      min-width: 2.75rem;
      min-height: 2.75rem;
    }
    :global(.detail-action) {
      min-height: 2.75rem;
    }
  }
</style>
