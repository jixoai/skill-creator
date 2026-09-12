<!--
  单路由完整编辑面（redesign-model-tabs-and-agent-panel S1；R7 8.2/8.6/8.7 重写；
  R12-A 五项交互收敛 [2026-09-12]）。
  用户原始需求 [2026-09-12]：「一个 tab 承载一条 DshModelRoute 的全部横向」；
  「颜色与 Letter 分离：图标（含无图标）、头像颜色（iconColor）、Letter 文字
  （iconLetter）三个独立控制」；「api 从自由输入改为 Select（DSH_ROUTE_API_PROTOCOLS），
  预设路径同字段预填可改」；「Models 区重构为模型 list-item 列表 + Add model，
  每条目全字段 + 连接测试；effort 数据源 = 当前模型的 efforts ?? 自由输入」。
  用户原始需求 [2026-09-12 R10]：「@cf/... 这明显是无效的」（补全池当前 provider
  置顶、跨 provider 剔命名空间 id）；「Add model 默认 efforts 三档 Low/High/Max」；
  「折叠行 dirty 小圆点」。
  用户原始需求 [2026-09-12 R12-A]：「一共只提供一个 save 按钮就好，现在给了 3 个，
  save 和 remove 都放到右上角」；「AddModel，新增的 Model，要 scrollInToView」；
  「Active model 这个配置没有意义，删掉」（活动模型切换唯一入口 = composer 下拉）；
  「key 直接通过一个 input-password 直接显示出来，提供 eye-toggle 即可」。
  正交意图：
  1. 布局：右上角全局动作行（Save + Remove icon-button）/ Identity（图标三控制 +
     只读路由名 + preset 次级文字按钮 + key 状态 pill）/ Credential（常驻
     password 输入 + eye-toggle + Clear）/ Endpoint（baseURL + api Select）/
     Models（ModelListItem 列表 + Add model；新增条目 scrollIntoView）。
  2. 写路径：全局 Save 把 endpoint + models 的全部脏改动合并为一次
     updateAgentSettings({modelRoutes}) 补丁；identity 三控制在 pick 时即时落库
     （IconPicker 无草稿态）；key 走 setAgentCredential/clear 旁路（值永不回流）。
  3. 数据源派生：ModelListItem 补全池 = catalogModelCandidates（R10-1：当前
     provider（编号 slug 归一 base）置顶 + 跨 provider 净化并集）；新增条目
     efforts 默认三档（DEFAULT_MODEL_EFFORTS）；条目级 dirty 传给折叠行小圆点。
  妥协声明：路由名只读——provider 名 = 凭据 env 映射键（dshRouteApiKeyEnv），
  改名等于换身份需重粘 key，以「复制重建」覆盖改名需求（design §7）。
-->
<script lang="ts">
  import { tick } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import IconPicker from "./IconPicker.svelte";
  import ModelListItem from "./ModelListItem.svelte";
  import IconEye from "@lucide/svelte/icons/eye";
  import IconEyeOff from "@lucide/svelte/icons/eye-off";
  import IconTrash from "@lucide/svelte/icons/trash-2";
  import { routeAvatarColor, routeLetter, resolveRouteIcon } from "./route-icon.js";
  import { numberedSlugParts, routeDisplayLabel } from "./route-naming.js";
  import {
    catalogModelCandidates,
    DEFAULT_MODEL_EFFORTS,
    type RouteModelEntry,
  } from "./model-fields.js";
  import {
    agentRuntimeConfig,
    clearAgentCredential,
    setAgentCredential,
    updateAgentSettings,
  } from "$lib/stores/agent.svelte";
  import {
    DSH_ROUTE_API_PROTOCOLS,
    type DshModelRoute,
    type ModelProviderCatalogEntry,
  } from "$shared/contracts/dsh-runtime.js";

  interface Props {
    route: DshModelRoute;
    catalog: { providers: ModelProviderCatalogEntry[] } | null;
    /** 新建引导：挂载即聚焦凭据输入；完成后经 onCredentialFocused 清除。 */
    autoFocusCredential?: boolean;
    onCredentialFocused?: () => void;
    /** 请求移除（确认对话框由分区持有——tab 条 Delete 键与本按钮共用一条路径）。 */
    onremove?: () => void;
  }

  let {
    route,
    catalog,
    autoFocusCredential = false,
    onCredentialFocused,
    onremove,
  }: Props = $props();

  const DEFAULT_API = "anthropic-messages";

  const view = $derived(agentRuntimeConfig.view);
  const routes = $derived(view?.settings.modelRoutes ?? []);
  /** 全路由模型并集（effort 候选自派生源：用户已配置 efforts 的并集，B2）。 */
  const allRouteModels = $derived(
    routes.flatMap((existing) =>
      existing.models.map((model) => ({ id: model.id, efforts: model.efforts })),
    ),
  );
  const catalogEntry = $derived(
    catalog?.providers.find((entry) => entry.provider === route.provider),
  );
  const catalogIconList = $derived(
    (catalog?.providers ?? []).flatMap((entry) =>
      entry.icon ? [{ provider: entry.provider, icon: entry.icon }] : [],
    ),
  );
  /** 补全池（R10-1 净化/置顶）：编号 slug（zai-2）归一到目录 base provider 后
   * 置顶该 provider 的模型（含命名空间 id），其余供应商剔除命名空间 id。 */
  const modelCandidates = $derived(
    catalogModelCandidates(catalog, numberedSlugParts(route.provider)?.base ?? route.provider),
  );
  const routeIcon = $derived(resolveRouteIcon(route, catalogEntry));
  const displayName = $derived(routeDisplayLabel(route, catalog));
  const avatarLetter = $derived(routeLetter(route, displayName));
  const avatarColor = $derived(routeAvatarColor(route));
  const keyReady = $derived(
    view?.providers.some((p) => p.provider === route.provider && p.configured) ?? false,
  );

  /** Endpoint 草稿（全局 Save；tab 切换经分区 {#key} 重挂载自然重置）。 */
  // svelte-ignore state_referenced_locally
  let baseURLDraft = $state(route.baseURL);
  // svelte-ignore state_referenced_locally
  let apiDraft = $state(route.api ?? catalogEntry?.api ?? DEFAULT_API);
  /** Models 草稿（dirty-gated 全局 Save；条目字段见 ModelListItem）。 */
  // svelte-ignore state_referenced_locally
  let modelsDraft = $state<RouteModelEntry[]>(route.models.map((entry) => ({ ...entry })));
  // svelte-ignore state_referenced_locally
  let modelsValid = $state<boolean[]>(route.models.map(() => true));
  /** 常驻凭据输入（R12-A5）：只装新输入；已存 key 永不回显。 */
  let apiKeyDraft = $state("");
  let keyVisible = $state(false);
  // svelte-ignore state_referenced_locally
  let addedHint = $state(autoFocusCredential);
  let credInput = $state<HTMLInputElement | null>(null);
  let rejection = $state<string | null>(null);
  let savedFlash = $state(false);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  /** Models 条目元素索引（Add model 后 scrollIntoView 定位锚）。 */
  let modelItemEls: (HTMLElement | null)[] = [];

  const endpointDirty = $derived(
    baseURLDraft.trim() !== route.baseURL ||
      apiDraft !== (route.api ?? catalogEntry?.api ?? DEFAULT_API),
  );
  const modelsDirty = $derived(JSON.stringify(modelsDraft) !== JSON.stringify(route.models));
  const modelsAllValid = $derived(modelsValid.every((flag) => flag));
  /** 全局 Save 门（R12-A2）：tab 内任一块 dirty 且校验通过才解禁。 */
  const saveDisabled = $derived(
    !(endpointDirty || modelsDirty) ||
      !modelsAllValid ||
      modelsDraft.length === 0 ||
      agentRuntimeConfig.updating,
  );

  // 新建引导：挂载即聚焦常驻凭据输入；autoFocus 路径同时清除分区挂起标记。
  $effect(() => {
    if (autoFocusCredential && credInput !== null) {
      credInput.focus();
      onCredentialFocused?.();
    }
  });

  $effect(() => {
    return () => {
      if (savedTimer !== null) clearTimeout(savedTimer);
    };
  });

  /** 全量补丁本路由（其余路由原样透传）；结果投影为 rejection。 */
  async function patchRoute(next: DshModelRoute): Promise<boolean> {
    if (view === null) return false;
    const result = await updateAgentSettings({
      modelRoutes: routes.map((existing) =>
        existing.provider === route.provider ? next : existing,
      ),
    });
    if (!result) return false;
    if (result.outcome === "rejected") {
      rejection = `${result.code}: ${result.detail}`;
      return false;
    }
    if (result.outcome === "error") {
      rejection = result.message;
      return false;
    }
    rejection = null;
    return true;
  }

  /** icon/iconColor/iconLetter/iconSuppressed = undefined 表示清除覆盖（回退
   * 目录图标/确定性色相/首字母/不抑制）。iconSuppressed = true 表示显式无图标
   * （目录 provider 也能选 Letter 头像；codex R7 B3）。 */
  async function applyIdentity(patch: {
    icon?: string;
    iconColor?: string;
    iconLetter?: string;
    iconSuppressed?: boolean;
  }): Promise<void> {
    await patchRoute({ ...route, ...patch });
  }

  /** 全局 Save（R12-A2）：endpoint + models 全部脏改动合并为一次补丁；identity
   * 三控制已在 pick 时即时落库（无草稿态），经 {...route} 透传不丢。 */
  async function saveAll(): Promise<void> {
    const baseURL = baseURLDraft.trim();
    if (!/^https?:\/\//.test(baseURL)) {
      rejection = "Custom route needs an http(s) base URL.";
      return;
    }
    const ok = await patchRoute({
      ...route,
      baseURL,
      api: apiDraft,
      models: modelsDraft.map((entry) => ({ ...entry })),
    });
    if (!ok) return;
    // 保存确认：1.5s Saved ✓ 回显在右上角按钮上；组件卸载清 timer。
    savedFlash = true;
    if (savedTimer !== null) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (savedFlash = false), 1500);
  }

  function setModelAt(index: number, next: RouteModelEntry): void {
    modelsDraft = modelsDraft.map((entry, i) => (i === index ? next : entry));
  }

  function setModelValidity(index: number, valid: boolean): void {
    if (modelsValid[index] === valid) return;
    modelsValid = modelsValid.map((flag, i) => (i === index ? valid : flag));
  }

  function removeModel(index: number): void {
    modelsDraft = modelsDraft.filter((_, i) => i !== index);
    modelsValid = modelsValid.filter((_, i) => i !== index);
  }

  /** 条目级 dirty（R10-2 折叠行小圆点）：草案与已存路由逐条对照。 */
  function modelEntryDirty(index: number): boolean {
    const draft = modelsDraft[index];
    const saved = route.models[index];
    if (draft === undefined || saved === undefined) return true;
    return JSON.stringify(draft) !== JSON.stringify(saved);
  }

  /** 新增条目（R10-5 + R12-A3）：efforts 默认三档写入草稿；空 id 挂载即展开；
   * DOM 更新后将条目滚入视野（nearest + smooth）。 */
  async function addModel(): Promise<void> {
    modelsDraft = [...modelsDraft, { id: "", efforts: [...DEFAULT_MODEL_EFFORTS] }];
    modelsValid = [...modelsValid, false];
    await tick();
    modelItemEls[modelItemEls.length - 1]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** 常驻凭据输入（R12-A5 + R13 用户修正）：失焦/Enter 保存但**不清空已输入值**
   * （password 掩码展示，blur 清空曾被用户判为数据丢失；替换语义 = 改写后再次
   * 失焦即覆盖保存）。空输入 no-op；已存 key 以占位提示，值永不回显。 */
  async function saveCredential(): Promise<void> {
    const key = apiKeyDraft.trim();
    if (key.length === 0) return;
    const result = await setAgentCredential(route.provider, key);
    if (!result) return;
    if (result.outcome === "rejected") {
      rejection = `${result.code}: ${result.detail}`;
      return;
    }
    rejection = null;
    addedHint = false;
  }

  async function clearCredential(): Promise<void> {
    await clearAgentCredential(route.provider);
    apiKeyDraft = "";
  }
</script>

<div class="space-y-3">
  <!-- 块 0 · 全局动作行（R12-A2：唯一 Save + Remove 都在右上角；gap-2.5 保证
       Remove 的 44px after 外扩命中区与 Save 不相交）。 -->
  <div class="flex items-center justify-end gap-2.5">
    <button
      type="button"
      class="relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
      aria-label="Remove route"
      title="Remove route"
      disabled={agentRuntimeConfig.updating}
      onclick={() => onremove?.()}
    >
      <IconTrash class="h-4 w-4" aria-hidden="true" />
    </button>
    <Button
      size="sm"
      class="relative h-9 px-3 text-xs after:absolute after:-top-1 after:-bottom-1 after:left-0 after:right-0 after:content-['']"
      data-route-save="true"
      disabled={saveDisabled}
      onclick={() => void saveAll()}
    >
      {savedFlash ? "Saved ✓" : "Save"}
    </Button>
  </div>

  <!-- 块 1 · Identity（图标 + 颜色 + Letter 三控制；preset 次级文字按钮）。 -->
  <div class="flex items-start gap-2">
    <IconPicker
      icon={routeIcon}
      letter={avatarLetter}
      color={avatarColor}
      provider={route.provider}
      label={displayName}
      catalogIcons={catalogIconList}
      disabled={agentRuntimeConfig.updating}
      onPick={(icon) => void applyIdentity({ icon, iconSuppressed: false })}
      onSuppress={() => void applyIdentity({ icon: undefined, iconSuppressed: true })}
      onColor={(iconColor) => void applyIdentity({ iconColor })}
      onLetter={(iconLetter) => void applyIdentity({ iconLetter })}
    />
    <div class="min-w-0 flex-1">
      <p
        class="truncate text-sm font-semibold"
        title="{displayName} ({route.provider}) — route name keys the credential mapping; duplicate this route to rename it."
      >
        {displayName}
      </p>
      <p class="mt-0.5 truncate text-[10px] text-muted-foreground" title={route.baseURL}>
        {route.provider} · {route.baseURL.replace(/^https?:\/\//, "")} · {route.models.length}
        {route.models.length === 1 ? "model" : "models"}
      </p>
    </div>
  </div>

  <!-- 块 2 · Credential（R12-A5 + R13：常驻 password 输入 + eye-toggle；key 状态
       样式并入本区标签行（用户裁决：Identity 的 key pill 与 Save as preset 删除，
       右上角只留 [Remove][Save]）。 -->
  <section class="space-y-1.5 rounded-md border border-border p-2" aria-label="Credential">
    {#if addedHint}
      <p class="text-[11px] font-medium text-primary">
        Route “{route.provider}” added — paste its API key to finish connecting.
      </p>
    {/if}
    <div class="flex items-center justify-between">
      <span class="text-[10px] font-medium text-muted-foreground">API key</span>
      <span
        class="rounded px-1.5 py-0.5 text-[10px] {keyReady
          ? 'bg-primary/10 text-primary'
          : 'bg-amber-500/15 text-amber-700'}"
        title={keyReady
          ? "API key configured — enter a new one to replace it"
          : "API key missing — connection test needs it"}
      >
        {keyReady ? "key ✓" : "key missing"}
      </span>
    </div>
    <div class="flex gap-1.5">
      <div class="relative min-w-0 flex-1">
        <Input
          class="h-8 pr-9 text-xs"
          type={keyVisible ? "text" : "password"}
          autocomplete="off"
          aria-label="API key"
          placeholder={keyReady ? "stored — enter to replace" : "API key"}
          bind:ref={credInput}
          bind:value={apiKeyDraft}
          disabled={agentRuntimeConfig.updating}
          onblur={() => void saveCredential()}
          onkeydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveCredential();
            }
          }}
        />
        <button
          type="button"
          class="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          aria-label={keyVisible ? "Hide API key" : "Show API key"}
          aria-pressed={keyVisible}
          title={keyVisible ? "Hide API key" : "Show API key"}
          disabled={agentRuntimeConfig.updating}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => (keyVisible = !keyVisible)}
        >
          {#if keyVisible}
            <IconEyeOff class="h-3.5 w-3.5" aria-hidden="true" />
          {:else}
            <IconEye class="h-3.5 w-3.5" aria-hidden="true" />
          {/if}
        </button>
      </div>
      {#if keyReady}
        <Button
          size="sm"
          variant="outline"
          class="relative h-9 px-2.5 text-xs after:absolute after:-top-1 after:-bottom-1 after:left-0 after:right-0 after:content-['']"
          disabled={agentRuntimeConfig.updating}
          onclick={() => void clearCredential()}
        >
          Clear
        </Button>
      {/if}
    </div>
    <span class="text-[10px] text-muted-foreground">
      Keys are stored locally (0600), never echoed back, and apply immediately.
    </span>
  </section>

  <!-- 块 3 · Endpoint（baseURL + api Select；脏态由右上角全局 Save 持久化）。 -->
  <section class="space-y-1.5 rounded-md border border-border p-2" aria-label="Endpoint">
    <span class="text-[11px] font-medium text-muted-foreground">Endpoint</span>
    <div class="flex gap-1.5">
      <Input
        class="h-8 flex-1 font-mono text-xs"
        aria-label="Base URL"
        placeholder="https://api.example.com/v1"
        bind:value={baseURLDraft}
        disabled={agentRuntimeConfig.updating}
      />
    </div>
    <label class="block space-y-0.5">
      <span class="text-[10px] text-muted-foreground">API protocol</span>
      <select
        class="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
        aria-label="API protocol"
        bind:value={apiDraft}
        disabled={agentRuntimeConfig.updating}
      >
        {#each DSH_ROUTE_API_PROTOCOLS as protocol (protocol)}
          <option value={protocol}>{protocol}</option>
        {/each}
      </select>
    </label>
  </section>

  <!-- 块 4 · Models（ModelListItem 列表 + Add model；R7 8.7 + R12-A3 滚入视野）。 -->
  <section class="space-y-1.5" aria-label="Models">
    <div class="flex items-center justify-between">
      <span class="text-[11px] font-medium text-muted-foreground">Models</span>
      <div class="flex items-center gap-1.5">
        {#if modelsDraft.length === 0}
          <span class="text-[10px] text-amber-700">A route needs at least one model id.</span>
        {/if}
        <Button
          size="sm"
          variant="ghost"
          class="h-6 px-2 text-[11px]"
          disabled={agentRuntimeConfig.updating}
          onclick={() => void addModel()}
        >
          + Add model
        </Button>
      </div>
    </div>
    <div class="space-y-1.5">
      {#each modelsDraft as entry, index (index)}
        <div bind:this={modelItemEls[index]}>
          <ModelListItem
            model={entry}
            candidates={modelCandidates}
            routeModels={allRouteModels}
            api={apiDraft}
            baseURL={baseURLDraft.trim()}
            provider={route.provider}
            apiKeyConfigured={keyReady}
            disabled={agentRuntimeConfig.updating}
            dirty={modelEntryDirty(index)}
            initialExpanded={entry.id === ""}
            onchange={(next) => setModelAt(index, next)}
            onremove={() => removeModel(index)}
            onvalidity={(valid) => setModelValidity(index, valid)}
          />
        </div>
      {/each}
    </div>
  </section>

  {#if rejection}
    <p class="text-xs text-destructive" role="alert">{rejection}</p>
  {/if}
</div>
