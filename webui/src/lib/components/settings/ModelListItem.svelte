<!--
  单模型条目编辑卡（R7 8.7 建卡 + R10 走查 2/3/4/5 修订）。
  用户原始需求 [2026-09-12]：「废弃一个 tags-input 配全部模型。Models 块 = 模型
  list-item 列表 + Add model；每个条目：modelId 输入（补全 + 选中已知 id 自动预填）、
  ModelName 自动生成可改、可用 Effort tags+补全、上下文窗口/最大输出 Token 简写
  解析、输入类型多选 chip、输出类型勾选、连接测试、移除。」（codex R7 B2/B4 纠偏
  [2026-09-12]：「Effort 设置这里，不能硬编码」——候选 = 标准档位 ∪ 目录 ∪ 路由
  并集；「新建自定义草案无法探活」——无已存 key 时提供 test-only key 输入。）
  用户原始需求 [2026-09-12 R12]：「effect 点击的时候会导致误删：Focus 然后 blur
  就会触发」——根因 = Efforts 曾以 <label> 包裹 tags-input，label 激活向首个
  labelable 后代（第一枚 × button）转发合成 click；修复 = label→div（本文件）
  + ModelTagsInput input DOM 前置防御。
  用户原始需求 [2026-09-12 R10]：「默认收起，只显示一行：ModelName + test/edit/
  remove 三个 icon-button（44px 命中区）；有未保存改动时名字旁加小圆点」；
  「input/output chips 选中 = primary 底白字，text 恒选中不可去（视觉锁定）；
  目录命中预填 inputTypes/maxOutputTokens/outputTypes；efforts 默认 Low/High/Max」。
  正交意图：
  1. 折叠态：header 行常驻（dirty 点 + 名称 + test/edit/remove icon-button）；
     展开态 = 全表单（id/name/efforts/token/类型/连接测试区）；连接测试在两种
     形态下走同一 runTest（折叠行内联回显 ok/failed 摘要）。
  2. 预填钩子（R10-3/4/5）：id 命中目录时预填 name/contextWindow/inputTypes
     （目录 inputTypes 优先，回退 image 旗标）/maxOutputTokens/outputTypes(恒
     text)/efforts(默认三档)；手触字段不被覆盖，换 modelId 时手触位复位重预填。
  3. token 简写：上下文/最大输出为文本域，失焦 parseTokenShorthand 校验——
     合法解析为数字并回显规范化格式，非法红边不提交（onvalidity 上抛阻断 Save）。
  4. 连接测试：调 agent.settings.testConnection；已存 key 走 provider 注入
     （输入面不带 key），未存 key 时显示 test-only password 输入、apiKey 直传
     不落盘；结果 typed：ok+latency / failed+detail。
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import ModelTagsInput from "./ModelTagsInput.svelte";
  import IconPencil from "@lucide/svelte/icons/pencil";
  import IconPlugZap from "@lucide/svelte/icons/plug-zap";
  import IconTrash from "@lucide/svelte/icons/trash-2";
  import {
    DEFAULT_MODEL_EFFORTS,
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
    /** 补全池（当前 provider 置顶 + 跨 provider 净化并集；手输仍允许任意 id）。 */
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
    /** 表单级 key 草稿（R13：NewRouteTab 的路由 key 输入直传测试；非空时隐藏
     * 条目级 test-only 输入并视为已可测，apiKeyConfigured 被其覆盖）。 */
    formKey?: string;
    disabled?: boolean;
    /** 条目有未保存改动（父级对照 saved 路由计算；折叠行名字旁小圆点）。 */
    dirty?: boolean;
    /** 挂载即展开（+ Add model 的新空条目；缺省收起）。 */
    initialExpanded?: boolean;
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
    formKey = "",
    disabled = false,
    dirty = false,
    initialExpanded = false,
    onchange,
    onremove,
    onvalidity,
  }: Props = $props();

  /** 测试可用 key：表单级草稿优先（R13），否则看已存凭据/条目级输入。 */
  const hasFormKey = $derived(formKey.trim().length > 0);

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
  /** 输出模态手触位（codex R11 P1：手选 image 后同 id 输入不得静默重置）。
   * 挂载即含 image 的已保存值同样是显式选择（非默认），视为已触。 */
  // svelte-ignore state_referenced_locally
  let outputTouched = $state((model.outputTypes ?? []).includes("image"));
  let contextTouched = $state(false);
  let maxOutTouched = $state(false);
  let effortsTouched = $state(false);
  let contextInvalid = $state(false);
  let maxOutInvalid = $state(false);
  let testing = $state(false);
  let testResult = $state<DshRouteConnectionTestResult | null>(null);
  /** 当前已命中的目录 id（换 modelId 的判定锚：重选手触位、重新预填）。 */
  // svelte-ignore state_referenced_locally
  let matchedId = $state<string | null>(model.id);
  // test-only key 草稿（codex R7 B4）：仅在无已存凭据时出现，直传探针不落盘。
  let draftKeyText = $state("");
  // 折叠态（R10-2）：默认收起，header 行常驻；+ Add model 的新空条目挂载即展开。
  // svelte-ignore state_referenced_locally
  let expanded = $state(initialExpanded);

  const idValid = $derived(idText.trim().length > 0);
  const valid = $derived(idValid && !contextInvalid && !maxOutInvalid);
  const currentInputTypes = $derived(new Set(model.inputTypes ?? ["text"]));
  const catalogMatch = $derived(candidates.find((entry) => entry.id === idText.trim()) ?? null);
  const effortPool = $derived(effortCandidates(routeModels, catalogMatch));
  const draftKey = $derived(draftKeyText.trim());
  const headerName = $derived(
    model.name ?? (model.id.length > 0 ? readableModelName(model.id) : "New model"),
  );
  const testDisabled = $derived(
    disabled ||
      !idValid ||
      testing ||
      api.length === 0 ||
      baseURL.length === 0 ||
      (!hasFormKey && !apiKeyConfigured && draftKey.length === 0),
  );

  $effect(() => {
    onvalidity(valid);
  });

  function emit(next: Partial<RouteModelEntry>): void {
    onchange({ ...model, ...next });
  }

  /** id 输入（R10-3/4/5 预填钩子）：换到另一个目录 id 时手触位复位、目录预填
   * 重新接管（「手选后不再被目录覆盖（除非再换 modelId）」）；改写为未知 id 时
   * 清掉未手触的派生预填（避免残留上一个 id 的字段成为脏数据；efforts 默认
   * 三档是新条目语义，不随目录命中与否清除）。 */
  function onIdInput(value: string): void {
    idText = value;
    const trimmed = value.trim();
    const candidate = candidates.find((entry) => entry.id === trimmed);
    const patch: Partial<RouteModelEntry> = { id: trimmed };
    if (candidate !== undefined) {
      if (trimmed !== matchedId) {
        nameTouched = false;
        contextTouched = false;
        maxOutTouched = false;
        inputsTouched = false;
        outputTouched = false;
        effortsTouched = false;
        matchedId = trimmed;
      }
      if (!nameTouched) {
        nameText = candidate.name ?? readableModelName(candidate.id);
        patch.name = nameText;
      }
      if (!contextTouched) {
        if (candidate.contextWindow !== undefined) {
          contextText = formatTokenCount(candidate.contextWindow);
          patch.contextWindow = candidate.contextWindow;
        } else if (model.contextWindow !== undefined) {
          contextText = "";
          patch.contextWindow = undefined;
        }
      }
      if (!maxOutTouched) {
        if (candidate.maxOutputTokens !== undefined) {
          maxOutText = formatTokenCount(candidate.maxOutputTokens);
          patch.maxOutputTokens = candidate.maxOutputTokens;
        } else if (model.maxOutputTokens !== undefined) {
          maxOutText = "";
          patch.maxOutputTokens = undefined;
        }
      }
      if (!inputsTouched) {
        // 目录 inputTypes 优先（R10-3）；缺省回退 image 旗标（目录投影里两者同源）。
        patch.inputTypes = candidate.inputTypes ?? (candidate.image ? ["text", "image"] : ["text"]);
      }
      // pi-ai 无 output 数据，产品默认恒含 text；手选 image 后同 id 输入不重置
      //（codex R11 P1：outputTouched 守卫，换 id 才回默认）。
      if (!outputTouched) patch.outputTypes = ["text"];
      if (!effortsTouched && model.efforts === undefined) {
        // R10-5：未显式配置 efforts 的条目在目录命中时预填默认三档（写入草稿，
        // Save 持久化）。
        patch.efforts = [...DEFAULT_MODEL_EFFORTS];
      }
    } else {
      // 离开目录 id：失效 matchedId 锚（codex R11 P1 终验——catalog A → custom C
      // → 回 catalog A 必须按「换 id」处理，不能因锚未更新而跳过复位）。
      matchedId = null;
      if (!nameTouched) {
        nameText = readableModelName(trimmed);
        if (model.name !== undefined) patch.name = undefined;
      }
      if (!contextTouched && model.contextWindow !== undefined) {
        contextText = "";
        patch.contextWindow = undefined;
      }
      if (!maxOutTouched && model.maxOutputTokens !== undefined) {
        maxOutText = "";
        patch.maxOutputTokens = undefined;
      }
      if (!inputsTouched && model.inputTypes !== undefined) patch.inputTypes = undefined;
      if (!outputTouched && model.outputTypes !== undefined) patch.outputTypes = undefined;
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
    next.add("text"); // text 必含不可去（chips 视觉锁定）
    const ordered: DshModelInputType[] = [
      "text",
      ...OPTIONAL_INPUT_TYPES.filter((entry) => next.has(entry)),
    ];
    emit({ inputTypes: ordered });
  }

  /** 输出模态集（codex R11 P1：output 同款 selectTags；目录无数据默认 ["text"]）。 */
  const currentOutputTypes = $derived(new Set(model.outputTypes ?? ["text"]));

  function toggleOutputType(kind: "image"): void {
    outputTouched = true;
    const next = new Set(currentOutputTypes);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    next.add("text"); // text 必含不可去
    emit({ outputTypes: (["text", "image"] as const).filter((entry) => next.has(entry)) });
  }

  async function runTest(): Promise<void> {
    // key 优先级（R13）：表单级 formKey 直传 > 已存凭据 provider 注入 > 条目级
    // test-only draft 直传（探活用完即弃，不写凭据存储）。直传 apiKey 时**不带
    // provider**（R13 codex P1：payload 契约——直传即全部凭据事实，避免与注入
    // 路径歧义）。
    if (testing || !idValid) return;
    if (!hasFormKey && !apiKeyConfigured && draftKey.length === 0) return;
    const directKey = hasFormKey ? formKey.trim() : apiKeyConfigured ? null : draftKey;
    testing = true;
    testResult = null;
    const result = await testRouteConnection({
      api,
      baseURL,
      modelId: idText.trim(),
      ...(directKey === null ? (provider.length > 0 ? { provider } : {}) : { apiKey: directKey }),
    });
    testing = false;
    if (result !== null) testResult = result;
  }
</script>

<div class="space-y-1.5 rounded-md border border-border p-2" aria-label="Model {model.id}">
  <!-- 折叠 header 行（R10-2）：dirty 点 + 名称 + test/edit/remove（44px 命中区）。 -->
  <div class="flex items-center justify-between gap-2">
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      {#if dirty}
        <span
          class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
          title="Unsaved changes"
          aria-label="Unsaved changes"
        ></span>
      {/if}
      <span class="min-w-0 truncate text-xs font-medium" title={model.id} data-header-name="true"
        >{headerName}</span
      >
      {#if !expanded}
        <span
          class="min-w-0 shrink-0 truncate text-[10px] {testResult?.outcome === 'ok'
            ? 'text-primary'
            : testResult?.outcome === 'failed'
              ? 'text-destructive'
              : 'text-muted-foreground'}"
          data-header-status="true"
        >
          {#if testing}
            testing…
          {:else if testResult?.outcome === "ok"}
            ok · {testResult.latencyMs} ms
          {:else if testResult?.outcome === "failed"}
            failed · {testResult.detail}
          {/if}
        </span>
      {/if}
    </div>
    <div class="flex shrink-0 items-center">
      <button
        type="button"
        class="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        aria-label="Test connection for {model.id || 'new model'}"
        title={hasFormKey
          ? "Send a minimal probe with the route key (saved on add)"
          : apiKeyConfigured
            ? "Send a minimal probe request"
            : "Expand and paste a key to test (not saved)"}
        disabled={testDisabled}
        onclick={() => void runTest()}
      >
        <IconPlugZap class="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        aria-label="Edit model {model.id || 'new model'}"
        title={expanded ? "Collapse model form" : "Edit model fields"}
        {disabled}
        onclick={() => (expanded = !expanded)}
      >
        <IconPencil class="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
        aria-label="Remove model {model.id}"
        title="Remove model"
        {disabled}
        onclick={() => onremove()}
      >
        <IconTrash class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  </div>

  {#if expanded}
    <div class="grid grid-cols-2 gap-1.5">
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
    </div>

    <!-- R12-A1：不用 <label> 包裹——chips 的 × button 是 labelable 后代，label
         激活会把 chip 主体的点击转发成第一枚 × 的合成 click（误删第一枚 chip）。
         标题用 span，点击面语义不变。 -->
    <div class="block space-y-0.5">
      <span class="text-[10px] text-muted-foreground">Efforts</span>
      <ModelTagsInput
        selected={model.efforts ?? []}
        candidates={effortPool.candidates.map((id) => ({ id }))}
        placeholder="Add effort (e.g. low)…"
        {disabled}
        onchange={(next) => {
          // 手选 effort = 显式配置：目录预填不再覆盖（除非换 modelId）。
          effortsTouched = true;
          emit(next.length > 0 ? { efforts: next } : { efforts: undefined });
        }}
      />
      {#if effortPool.hint !== null}
        <p class="text-[10px] text-muted-foreground" role="note">{effortPool.hint}</p>
      {/if}
    </div>

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

    <!-- 输入/输出 chips（R10-3 / codex R11 P1）：两侧同款 selectTags 交互——
         选中 = primary 底白字；未选中 = muted 边框态；text 恒选中不可去（锁定
         chip 保持视觉一致）。output 无目录数据（pi-ai 镜像缺失），默认 ["text"]，
         image 可切换持久化。 -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-1">
        <span class="text-[10px] text-muted-foreground">Inputs:</span>
        <span
          class="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground"
          title="Text is always required"
          data-input-chip="text">text</span
        >
        {#each OPTIONAL_INPUT_TYPES as kind (kind)}
          <button
            type="button"
            class="rounded border px-1.5 py-0.5 text-[10px] transition-colors {currentInputTypes.has(
              kind,
            )
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:bg-muted'}"
            aria-pressed={currentInputTypes.has(kind)}
            {disabled}
            onclick={() => toggleInputType(kind)}
          >
            {kind}
          </button>
        {/each}
      </div>
      <div class="flex items-center gap-1">
        <span class="text-[10px] text-muted-foreground">Outputs:</span>
        <span
          class="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground"
          title="Text output is always required"
          data-output-chip="text">text</span
        >
        <button
          type="button"
          class="rounded border px-1.5 py-0.5 text-[10px] transition-colors {currentOutputTypes.has(
            'image',
          )
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-background text-muted-foreground hover:bg-muted'}"
          aria-pressed={currentOutputTypes.has("image")}
          title="Image output (image-generation models)"
          {disabled}
          onclick={() => toggleOutputType("image")}
          data-output-chip="image"
        >
          image
        </button>
      </div>
    </div>

    <div class="flex items-center justify-between gap-2 border-t border-border pt-1.5">
      <span
        class="min-w-0 truncate text-[10px] {testResult?.outcome === 'ok'
          ? 'text-primary'
          : testResult?.outcome === 'failed'
            ? 'text-destructive'
            : 'text-muted-foreground'}"
        data-form-status="true"
      >
        {#if testResult?.outcome === "ok"}
          ok · {testResult.latencyMs} ms
        {:else if testResult?.outcome === "failed"}
          failed · {testResult.detail}
        {:else if hasFormKey}
          Probing with the route key above (saved on add).
        {:else if !apiKeyConfigured}
          No saved key for this route — paste one to test (never stored).
        {:else}
          Probe this endpoint with a minimal request.
        {/if}
      </span>
      <span class="flex shrink-0 items-center gap-1.5">
        {#if !apiKeyConfigured && !hasFormKey}
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
          disabled={testDisabled}
          title={hasFormKey
            ? "Send a minimal probe with the route key above (saved on add)"
            : apiKeyConfigured
              ? "Send a minimal probe request"
              : "Send a minimal probe with the pasted key (not saved)"}
          onclick={() => void runTest()}
        >
          {testing ? "Testing…" : "Test connection"}
        </Button>
      </span>
    </div>
  {/if}
</div>
