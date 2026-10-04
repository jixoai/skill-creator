<!--
  设置面 General 分区（add-agent-settings-modes 迭代；2026-09-30
  shell-settings-ui：新增 Appearance 偏好）。
  修订 [2026-10-02]（design-critique R2）：helper 散文压缩——每项一行，删重复
  解释（操作后果语义保留）。
  修订 [2026-10-05]（webui-i18n-bilingual 4.2）：Appearance 新增 Language 行
  （English/中文 分段控件，setLocale/currentLocale 消费；DevicePrefs.language
  持久化由 i18n 基建完成）。
  正交意图：
  1. daemon 连接状态投影（连接/断开/重连中可见；断开时给出恢复提示）。
  2. Appearance（设备偏好，localStorage 单源）：主题三选（Light/Dark/System，
     .dark 类立即生效）+ 侧栏默认折叠开关 + 语言二选（en/zh，词典立即切换）。
-->
<script lang="ts">
  import { connectionState } from "$lib/store.svelte";
  import { t, currentLocale, setLocale, type Locale } from "$lib/i18n";
  import {
    appearanceSidebarCollapsed,
    appearanceTheme,
    setAppearanceTheme,
    toggleAppearanceSidebar,
  } from "$lib/shell/appearance.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
  import IconPlug from "@lucide/svelte/icons/plug-zap";
  import IconUnplug from "@lucide/svelte/icons/plug";

  const statusLabel = $derived.by(() => {
    switch (connectionState.status) {
      case "connected":
        return t("settings.general.statusConnected");
      case "connecting":
        return t("settings.general.statusConnecting");
      case "disconnected":
        return t("settings.general.statusDisconnected");
      default:
        return t("settings.general.statusIdle");
    }
  });

  const theme = $derived(appearanceTheme());
  const sidebarCollapsed = $derived(appearanceSidebarCollapsed());
  const locale = $derived(currentLocale());

  const THEME_OPTIONS: ReadonlyArray<{
    value: "light" | "dark" | "system";
    labelKey: Parameters<typeof t>[0];
  }> = [
    { value: "light", labelKey: "settings.general.themeLight" },
    { value: "dark", labelKey: "settings.general.themeDark" },
    { value: "system", labelKey: "settings.general.themeSystem" },
  ];

  /** 语言分段控件（4.2）：读取 currentLocale() 建立追踪，切换即时生效。
   * 选项标签用原生名（English/中文）——两语言下同值，经词典保持单一文案源。 */
  const LANGUAGE_OPTIONS: ReadonlyArray<{
    value: Locale;
    labelKey: Parameters<typeof t>[0];
  }> = [
    { value: "en", labelKey: "settings.general.languageEnglish" },
    { value: "zh", labelKey: "settings.general.languageChinese" },
  ];
</script>

<div class="space-y-4">
  <div>
    <h3 class="text-sm font-medium">{t("settingsPage.sectionGeneral")}</h3>
    <p class="mt-0.5 text-[11px] text-muted-foreground">
      {t("settings.general.subtitle")}
    </p>
  </div>

  <section class="space-y-1.5" aria-label={t("settings.general.daemon")}>
    <span class="text-[11px] font-medium text-muted-foreground">{t("settings.general.daemon")}</span
    >
    <div class="flex items-center gap-2 rounded-md border border-border bg-background/60 p-2.5">
      {#if connectionState.status === "connected"}
        <IconPlug class="h-4 w-4 text-primary" />
      {:else}
        <IconUnplug
          class="h-4 w-4 {connectionState.status === 'disconnected'
            ? 'text-destructive'
            : 'text-muted-foreground'}"
        />
      {/if}
      <span
        class="text-xs {connectionState.status === 'connected'
          ? 'text-primary'
          : connectionState.status === 'disconnected'
            ? 'text-destructive'
            : 'text-muted-foreground'}"
      >
        {statusLabel}
      </span>
    </div>
    {#if connectionState.status === "disconnected"}
      <p class="text-[10px] text-destructive" role="alert">{connectionState.error}</p>
    {:else}
      <p class="text-[10px] text-muted-foreground">
        {t("settings.general.reconnectHintLead")}<code class="rounded bg-muted px-1 font-mono"
          >skill-creator start</code
        >{t("settings.general.reconnectHintTail")}
      </p>
    {/if}
  </section>

  <section class="space-y-1.5" aria-label={t("settings.general.appearance")}>
    <span class="text-[11px] font-medium text-muted-foreground"
      >{t("settings.general.appearance")}</span
    >

    <div
      class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/60 p-2.5"
    >
      <div>
        <p class="text-xs font-medium">{t("settings.general.theme")}</p>
        <p class="text-[10px] text-muted-foreground">
          {t("settings.general.themeHint")}
        </p>
      </div>
      <!-- 走查 #4：行级 flex-wrap 让分段控件在窄内容区（Agent 面板开启）整组换行，
           控件自身 max-w-full + flex-wrap 兜底更窄场景——System 段不再被
           overflow-hidden 裁切；未选中段显式 bg-transparent，仅选中态上底色。 -->
      <div
        class="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-border"
        role="group"
        aria-label={t("settings.general.themeGroupAria")}
      >
        {#each THEME_OPTIONS as option (option.value)}
          <Button
            variant="ghost"
            size="sm"
            class="h-7 rounded-none px-2.5 text-xs {theme === option.value
              ? 'bg-accent text-primary'
              : 'bg-transparent text-muted-foreground'}"
            aria-pressed={theme === option.value}
            onclick={() => setAppearanceTheme(option.value)}
          >
            {t(option.labelKey)}
          </Button>
        {/each}
      </div>
    </div>

    <div
      class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/60 p-2.5"
    >
      <div>
        <p class="text-xs font-medium">{t("settings.general.language")}</p>
        <p class="text-[10px] text-muted-foreground">
          {t("settings.general.languageHint")}
        </p>
      </div>
      <div
        class="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-border"
        role="group"
        aria-label={t("settings.general.languageGroupAria")}
      >
        {#each LANGUAGE_OPTIONS as option (option.value)}
          <Button
            variant="ghost"
            size="sm"
            class="h-7 rounded-none px-2.5 text-xs {locale === option.value
              ? 'bg-accent text-primary'
              : 'bg-transparent text-muted-foreground'}"
            aria-pressed={locale === option.value}
            onclick={() => setLocale(option.value)}
          >
            {t(option.labelKey)}
          </Button>
        {/each}
      </div>
    </div>

    <div
      class="flex items-center justify-between rounded-md border border-border bg-background/60 p-2.5"
    >
      <div>
        <p class="text-xs font-medium">{t("settings.general.sidebarCollapsed")}</p>
        <p class="text-[10px] text-muted-foreground">
          {t("settings.general.sidebarCollapsedHint")}
        </p>
      </div>
      <Switch
        checked={sidebarCollapsed}
        onCheckedChange={() => toggleAppearanceSidebar()}
        aria-label={t("settings.general.sidebarCollapsed")}
      />
    </div>
  </section>
</div>
