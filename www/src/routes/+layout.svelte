<!--
  Orthogonal intents (maintained 2026-09-15; original user request: 新增
  www/ 产品官网，jixoai 家族风格、英文单语言单页落地):
  1. Site shell: the registry website-scaffold wrapping the page — sticky
     TerminalHeader band, main column, TerminalFooter ghost wordmark.
  2. Base-path law: every internal link resolves through $app/paths `base`
     (SITE_BASE feeds kit.paths.base); nothing hardcodes a prefix. In-page
     anchors carry no path at all.
  3. Scrollbar law hook: <jx-scrollbar-measure> registers once here so the
     per-OS scrollbar widths feed the padding-compensation tokens.
-->
<script lang="ts">
  import "$lib/scrollbar-measure";
  import "../app.css";
  import { base } from "$app/paths";
  import WebsiteScaffold from "$lib/ui/website-scaffold/website-scaffold.svelte";
  import TerminalHeader from "$lib/ui/terminal-header/terminal-header.svelte";
  import TerminalFooter from "$lib/ui/terminal-footer/terminal-footer.svelte";
  import TerminalFooterColumn from "$lib/ui/terminal-footer/terminal-footer-column.svelte";
  import NavigationMenu from "$lib/ui/navigation-menu/navigation-menu.svelte";
  import NavigationMenuLink from "$lib/ui/navigation-menu/navigation-menu-link.svelte";
  import ThemeToggle from "$lib/ui/theme-toggle/theme-toggle.svelte";
  import { GITHUB_URL, JIXOAI_URL, NPM_URL, SITE_DOMAIN, SITE_SUBTITLE } from "$lib/constants";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  // Base-path law: the brand link resolves through `base` in subpath builds
  // ('' in root builds — plain '/' stays canonical).
  const homeHref = base === "" ? "/" : `${base}/`;
</script>

<WebsiteScaffold>
  {#snippet header()}
    <TerminalHeader
      brand="Skill Creator"
      domain={SITE_DOMAIN}
      subtitle={SITE_SUBTITLE}
      {homeHref}
      switcherFrame={false}
    >
      {#snippet logo()}
        <!-- Flat Symbol（resources/README 法则：中等尺寸 UI 面用扁平纯色版） -->
        <img
          src={`${base}/logo-flat.png`}
          alt=""
          class="h-7 w-7"
          width="28"
          height="28"
          decoding="async"
        />
      {/snippet}
      {#snippet switcher()}
        <ThemeToggle variant="compact" />
      {/snippet}
      {#snippet drawer()}
        <div class="flex flex-col items-stretch gap-1 py-2">
          <NavigationMenuLink href={homeHref} current>Overview</NavigationMenuLink>
          <NavigationMenuLink href="#apps">Three apps</NavigationMenuLink>
          <NavigationMenuLink href="#agent-panel">Agent panel</NavigationMenuLink>
          <NavigationMenuLink href="#security">Security</NavigationMenuLink>
          <NavigationMenuLink href="#get-started">Get started</NavigationMenuLink>
          <NavigationMenuLink href={GITHUB_URL}>GitHub ↗</NavigationMenuLink>
          <NavigationMenuLink href={NPM_URL}>npm ↗</NavigationMenuLink>
        </div>
      {/snippet}
      <NavigationMenu label="site">
        <NavigationMenuLink href={homeHref} current>Overview</NavigationMenuLink>
        <NavigationMenuLink href="#apps">Three apps</NavigationMenuLink>
        <NavigationMenuLink href="#agent-panel">Agent panel</NavigationMenuLink>
        <NavigationMenuLink href="#security">Security</NavigationMenuLink>
        <NavigationMenuLink href={GITHUB_URL}>GitHub ↗</NavigationMenuLink>
        <NavigationMenuLink href={NPM_URL}>npm ↗</NavigationMenuLink>
      </NavigationMenu>
    </TerminalHeader>
  {/snippet}

  {@render children()}

  {#snippet footer()}
    <TerminalFooter
      ghost="SKILL CREATOR"
      copyright="Copyright © 2026 Skill Creator contributors · MIT"
    >
      <TerminalFooterColumn title="project">
        <a href={GITHUB_URL}>GitHub ↗</a>
        <a href={NPM_URL}>npm · skill-creator ↗</a>
      </TerminalFooterColumn>
      <TerminalFooterColumn title="family">
        <a href={JIXOAI_URL}>jixoai.com ↗</a>
      </TerminalFooterColumn>
    </TerminalFooter>
  {/snippet}
</WebsiteScaffold>
