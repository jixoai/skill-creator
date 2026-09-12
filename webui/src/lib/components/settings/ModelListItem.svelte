<!--
  单模型条目编辑卡（R7 8.7：Models 区重构为 ModelListItem）。
  用户原始需求 [2026-09-12]：「废弃一个 tags-input 配全部模型。Models 块 = 模型
  list-item 列表 + Add model；每个条目：modelId 输入（补全 + 选中已知 id 自动预填）、
  ModelName 自动生成可改、可用 Effort tags+补全、上下文窗口/最大输出 Token 简写
  解析、输入类型多选 chip、输出类型勾选、连接测试、移除。」（codex R7 B2/B4 纠偏
  [2026-09-12]：「Effort 设置这里，不能硬编码」——候选 = 全部路由 efforts 并集；
  「新建自定义草案无法探活」——无已存 key 时提供 test-only key 输入。）
  正交意图：
  1. 字段编辑：受控单条目（onchange 全量替换，父级持 draft 不落库）；id 命中
     补全集时预填 name/contextWindow/inputTypes（仅未手触字段）；name 缺省由
     readableModelName 派生。
  2. token 简写：上下文/最大输出为文本域，失焦 parseTokenShorthand 校验——
     合法解析为数字并回显规范化格式，非法红边不提交（onvalidity 上抛阻断 Save）。
  3. 连接测试：调 agent.settings.testConnection；已存 key 走 provider 注入
     （输入面不带 key），未存 key 时显示 test-only password 输入、apiKey 直传
     不落盘；结果 typed：ok+latency / failed+detail。
  妥协声明：不引入 @lucide 图标（root vitest 管线不编译 node_modules 的 .svelte，
  本组件需在集成测试内直接挂载）——移除等动作用文本按钮。
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import ModelTagsInput from "./ModelTagsInput.svelte";
  import {
    effortCandidates,
    formatTokenCount,
    readableModelName,
    type ModelCandidate,
    type RouteModelEntry,
  } from "./model-fields.js";
  import { testRouteConnection } from "$lib/stores/agent.svelte";
  import {
    parseTokenShorthand,
    type DshModelInputType,
    type DshRouteConnectionTestResult,
  } from "$shared/contracts/dsh-runtime.js";

  interface Props {
    model: RouteModelEntry;
    /** 补全池（全供应商并集；手输仍允许任意 id）。 */
    candidates: ModelCandidate[];
    /** effort 补全数据源（全部路由 + 草案已配置的模型；缺省 = 仅自由输入）。 */
    routeModels?: RouteModelEntry[];
    /** 连接测试参数面（api/baseURL 用路由草案，测完再保存的语义）。 */
    api: string;
    baseURL: string;
    /** 路由 provider（daemon 侧凭据注入引用；新建草案未定名时缺省）。 */
    provider?: string;
    /** 路由凭据已存（false = 显示 test-only key 输入后可测）。 */
    apiKeyConfigured: boolean;
    disabled?: boolean;
    onchange: (next: RouteModelEntry) => void;
    onremove: () => void;
    /** 条目合法性（id 空或 token 字段非法 → false，父级阻断 Save）。 */
    onvalidity: (valid: boolean) => void;
  }

  let {
    model,
    candidates,
    routeModels = [],
    api,
    baseURL,
    provider = "",
    apiKeyConfigured,
    disabled = false,
    onchange,
    onremove,
    onvalidity,
  }: Props = $props();

  const OPTIONAL_INPUT_TYPES: readonly DshModelInputType[] = ["image", "video", "pdf"];
  /** datalist id 实例化（多条目并存时不串档）。 */
  const listId = `model-id-candidates-${crypto.randomUUID()}`;

  // 本地草稿（挂载时从 model 初始化一次；父级 Save 前不做回写，避免输入打架）。
  // svelte-ignore state_referenced_locally
  let idText = $state(model.id);
  // svelte-ignore state_referenced_locally
  let nameText = $state(model.name ?? readableModelName(model.id));
  // svelte-ignore state_referenced_locally
  let contextText = $state(
    model.contextWindow !== undefined ? formatTokenCount(model.contextWindow) : "",
  );
  // svelte-ignore state_referenced_locally
  let maxOutText = $state(
    model.maxOutputTokens !== undefined ? formatTokenCount(model.maxOutputTokens) : "",
  );
  let nameTouched = $state(false);
  let inputsTouched = $state(false);
  let contextTouched = $state(false);
  let maxOutTouched = $state(false);
  let contextInvalid = $state(false);
  let maxOutInvalid = $state(false);
  let testing = $state(false);
  let testResult = $state<DshRouteConnectionTestResult | null>(null);
  // test-only key 草稿（codex R7 B4）：仅在无已存凭据时出现，直传探针不落盘。
  let draftKeyText = $state("");

  const idValid = $derived(idText.trim().length > 0);
  const valid = $derived(idValid && !contextInvalid && !maxOutInvalid);
  const currentInputTypes = $derived(new Set(model.inputTypes ?? ["text"]));
  const catalogMatch = $derived(candidates.find((entry) => entry.id === idText.trim()) ?? null);
  const effortPool = $derived(effortCandidates(routeModels, catalogMatch));
  const draftKey = $derived(draftKeyText.trim());

  $effect(() => {
    onvalidity(valid);
  });

  function emit(next: Partial<RouteModelEntry>): void {
    onchange({ ...model, ...next });
  }

  /** id 输入：命中已知 id 时自动预填未手触字段；改写为未知 id 时清掉派生预填
   * （避免残留上一个 id 的 name/contextWindow/inputTypes 成为脏数据）。 */
  function onIdInput(value: string): void {
    idText = value;
    const candidate = candidates.find((entry) => entry.id === value.trim());
    const patch: Partial<RouteModelEntry> = { id: value.trim() };
    if (candidate !== undefined) {
      if (!nameTouched) {
        nameText = candidate.name ?? readableModelName(candidate.id);
        patch.name = nameText;
      }
      if (contextText.trim().length === 0 && candidate.contextWindow !== undefined) {
        contextText = formatTokenCount(candidate.contextWindow);
        patch.contextWindow = candidate.contextWindow;
      }
      if (!inputsTouched) {
        patch.inputTypes = candidate.image ? ["text", "image"] : ["text"];
      }
    } else {
      if (!nameTouched && model.name !== undefined) patch.name = undefined;
      if (!contextTouched && model.contextWindow !== undefined) patch.contextWindow = undefined;
      if (!maxOutTouched && model.maxOutputTokens !== undefined) patch.maxOutputTokens = undefined;
      if (!inputsTouched && model.inputTypes !== undefined) patch.inputTypes = undefined;
    }
    emit(patch);
  }

  function onNameInput(value: string): void {
    nameText = value;
    nameTouched = true;
    emit(value.trim().length > 0 ? { name: value.trim() } : { name: undefined });
  }

  /** token 简写字段失焦：空 = 清除；合法 = 解析回显规范化；非法 = 红边不提交。 */
  function commitToken(field: "contextWindow" | "maxOutputTokens"): void {
    const raw = field === "contextWindow" ? contextText : maxOutText;
    const trimmed = raw.trim();
    const setInvalid = (flag: boolean): void => {
      if (field === "contextWindow") contextInvalid = flag;
      else maxOutInvalid = flag;
    };
    if (trimmed.length === 0) {
      setInvalid(false);
      emit(
        field === "contextWindow" ? { contextWindow: undefined } : { maxOutputTokens: undefined },
      );
      return;
    }
    const parsed = parseTokenShorthand(trimmed);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (field === "contextWindow") {
      contextText = formatTokenCount(parsed);
      contextTouched = true;
    } else {
      maxOutText = formatTokenCount(parsed);
      maxOutTouched = true;
    }
    emit(field === "contextWindow" ? { contextWindow: parsed } : { maxOutputTokens: parsed });
  }

  function toggleInputType(kind: DshModelInputType): void {
    inputsTouched = true;
    const next = new Set(currentInputTypes);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    next.add("text"); // text 必含不可去
    const ordered: DshModelInputType[] = [
      "text",
      ...OPTIONAL_INPUT_TYPES.filter((entry) => next.has(entry)),
    ];
    emit({ inputTypes: ordered });
  }

  async function runTest(): Promise<void> {
    // 已存 key → provider 注入路径（输入面无 key）；未存 → draft key 直传
    // （test-only：探活用完即弃，不写凭据存储）。
    if (testing || !idValid) return;
    if (!apiKeyConfigured && draftKey.length === 0) return;
    testing = true;
    testResult = null;
    const result = await testRouteConnection({
      api,
      baseURL,
      modelId: idText.trim(),
      ...(provider.length > 0 ? { provider } : {}),
      ...(!apiKeyConfigured && draftKey.length > 0 ? { apiKey: draftKey } : {}),
    });
    testing = false;
    if (result !== null) testResult = result;
  }
</script>

<div class="space-y-1.5 rounded-md border border-border p-2" aria-label="Model {model.id}">
  <div class="grid grid-cols-[1fr_1fr_auto] gap-1.5">
    <label class="min-w-0 space-y-0.5">
      <span class="text-[10px] text-muted-foreground">Model id</span>
      <Input
        class="h-8 font-mono text-xs"
        aria-label="Model id"
        placeholder="glm-5.3-flash"
        list={listId}
        bind:value={idText}
        {disabled}
        oninput={(event) => onIdInput(event.currentTarget.value)}
      />
      <datalist id={listId}>
        {#each candidates.slice(0, 200) as candidate (candidate.id)}
          <option value={candidate.id}>{candidate.name ?? ""}</option>
        {/each}
      </datalist>
    </label>
    <label class="min-w-0 space-y-0.5">
      <span class="text-[10px] text-muted-foreground">Name</span>
      <Input
        class="h-8 text-xs"
        aria-label="Model name"
        placeholder={readableModelName(idText.trim() || model.id)}
        bind:value={nameText}
        {disabled}
        oninput={(event) => onNameInput(event.currentTarget.value)}
      />
    </label>
    <button
      type="button"
      class="mt-4 h-8 shrink-0 rounded px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
      aria-label="Remove model {model.id}"
      {disabled}
      onclick={() => onremove()}
    >
      ×
    </button>
  </div>

  <label class="block space-y-0.5">
    <span class="text-[10px] text-muted-foreground">Efforts</span>
    <ModelTagsInput
      selected={model.efforts ?? []}
      candidates={effortPool.candidates.map((id) => ({ id }))}
      placeholder="Add effort (e.g. low)…"
      {disabled}
      onchange={(next) => emit(next.length > 0 ? { efforts: next } : { efforts: undefined })}
    />
    {#if effortPool.hint !== null}
      <p class="text-[10px] text-muted-foreground" role="note">{effortPool.hint}</p>
    {/if}
  </label>

  <div class="grid grid-cols-2 gap-1.5">
    <label class="min-w-0 space-y-0.5">
      <span class="text-[10px] text-muted-foreground">Context window</span>
      <Input
        class="h-8 text-xs {contextInvalid
          ? 'border-destructive focus-visible:ring-destructive'
          : ''}"
        aria-label="Context window (tokens)"
        placeholder="200k / 0.5M / 131072"
        bind:value={contextText}
        {disabled}
        onblur={() => commitToken("contextWindow")}
        onkeydown={(event) => {
          if (event.key === "Enter") commitToken("contextWindow");
        }}
      />
    </label>
    <label class="min-w-0 space-y-0.5">
      <span class="text-[10px] text-muted-foreground">Max output tokens</span>
      <Input
        class="h-8 text-xs {maxOutInvalid
          ? 'border-destructive focus-visible:ring-destructive'
          : ''}"
        aria-label="Max output tokens"
        placeholder="32k / 131072"
        bind:value={maxOutText}
        {disabled}
        onblur={() => commitToken("maxOutputTokens")}
        onkeydown={(event) => {
          if (event.key === "Enter") commitToken("maxOutputTokens");
        }}
      />
    </label>
  </div>
  {#if contextInvalid || maxOutInvalid}
    <p class="text-[10px] text-destructive" role="alert">
      Invalid token value — use numbers, or shorthand like 253k / 0.5M.
    </p>
  {/if}

  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap items-center gap-1">
      <span class="text-[10px] text-muted-foreground">Inputs:</span>
      <span
        class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
        title="Text is always required">text</span
      >
      {#each OPTIONAL_INPUT_TYPES as kind (kind)}
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-[10px] transition-colors {currentInputTypes.has(kind)
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground hover:bg-muted/70'}"
          aria-pressed={currentInputTypes.has(kind)}
          {disabled}
          onclick={() => toggleInputType(kind)}
        >
          {kind}
        </button>
      {/each}
    </div>
    <label
      class="flex items-center gap-1 text-[10px] text-muted-foreground"
      title="Text-only output in the current product surface"
    >
      <input type="checkbox" checked disabled class="h-3 w-3" />
      outputs text
    </label>
  </div>

  <div class="flex items-center justify-between gap-2 border-t border-border pt-1.5">
    <span
      class="min-w-0 truncate text-[10px] {testResult?.outcome === 'ok'
        ? 'text-primary'
        : testResult?.outcome === 'failed'
          ? 'text-destructive'
          : 'text-muted-foreground'}"
    >
      {#if testResult?.outcome === "ok"}
        ok · {testResult.latencyMs} ms
      {:else if testResult?.outcome === "failed"}
        failed · {testResult.detail}
      {:else if !apiKeyConfigured}
        No saved key for this route — paste one to test (never stored).
      {:else}
        Probe this endpoint with a minimal request.
      {/if}
    </span>
    <span class="flex shrink-0 items-center gap-1.5">
      {#if !apiKeyConfigured}
        <Input
          type="password"
          class="h-6 w-44 font-mono text-[10px]"
          aria-label="API key (test only)"
          placeholder="API key (test only)"
          autocomplete="off"
          bind:value={draftKeyText}
          {disabled}
        />
      {/if}
      <Button
        size="sm"
        variant="outline"
        class="h-6 shrink-0 px-2 text-[10px]"
        disabled={disabled ||
          !idValid ||
          testing ||
          api.length === 0 ||
          baseURL.length === 0 ||
          (!apiKeyConfigured && draftKey.length === 0)}
        title={apiKeyConfigured
          ? "Send a minimal probe request"
          : "Send a minimal probe with the pasted key (not saved)"}
        onclick={() => void runTest()}
      >
        {testing ? "Testing…" : "Test connection"}
      </Button>
    </span>
  </div>
</div>
