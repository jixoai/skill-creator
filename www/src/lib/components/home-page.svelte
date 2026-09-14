<!--
  Orthogonal intents (maintained 2026-09-15; original user request: 新增
  www/ 产品官网，单页落地、内容取自 README/CHANGELOG/Release 正文、英文
  客观无比喻、截图为真实 UI 裁剪):
  1. Hero: 一句话定位 + npm 全局安装 copy 命令 + skill-creator start
     终端卡（一次性 typing 入场）。
  2. 截图带：hero 之下的全宽 workspaces 截图（暗色真实 UI）。
  3. 三 App / Agent 面板 / 安全模型 / 环境与链接：SectionCard +
     data-table + 截图网格，产品事实全部来自仓库 README 边界表与
     CHANGELOG。
  4. Motion law: hero 自有 cascade，card-grid 拥有子卡入场；其余区块
     走主题 scroll-driven [data-reveal]。
-->
<script lang="ts">
  import HeroSection from "$lib/ui/hero-section/hero-section.svelte";
  import SectionCard from "$lib/ui/section-card/section-card.svelte";
  import CardGrid from "$lib/ui/card-grid/card-grid.svelte";
  import TerminalCard from "$lib/ui/terminal-card/terminal-card.svelte";
  import PressButton from "$lib/ui/press-button/press-button.svelte";
  import ResponsivePicture, { type PictureSet } from "$lib/components/responsive-picture.svelte";
  import { base } from "$app/paths";
  import { GITHUB_URL, JIXOAI_URL, NPM_URL, SITE_URL } from "$lib/constants";
  import workspacesShot from "$lib/assets/workspaces.png?w=720;1100;1440&format=webp;png&as=picture";
  import creatorShot from "$lib/assets/creator.png?w=720;1100;1440&format=webp;png&as=picture";
  import repositoryShot from "$lib/assets/repository.png?w=720;1100;1440&format=webp;png&as=picture";
  import agentPanelShot from "$lib/assets/agent-panel.png?w=500&format=webp;png&as=picture";

  // Content facts sourced from the repository README (产品边界 / 安全模型 /
  // 环境要求), CHANGELOG 2.0.x and the v2 release notes — no invented claims.
  const apps = [
    {
      id: "app-workspaces",
      eyebrow: "/workspaces",
      title: "Workspaces",
      summary:
        "Index the Global Workspace and imported workspaces. Inside each provider, discover, filter, inspect, validate, and enable or disable skills; compare them against upstream lock hashes and reinstall what drifted.",
      points: [
        "Global Workspace (~) aggregates agent global roots; read and manage, never a write target",
        "Every operation carries an explicit Workspace + Provider identity",
        "Skills Update compares the skills-CLI lock hash with upstream — read-only check, apply only reinstalls confirmed-outdated skills",
      ],
      detail: "first layer of skill scoping",
    },
    {
      id: "app-creator",
      eyebrow: "/creator",
      title: "Creator",
      summary:
        "Create, load, edit, and delete SKILL.md documents inside imported Workspace.Providers, with a change log per document.",
      points: [
        "Frontmatter round-trips through gray-matter; unknown valid fields pass through",
        "Updates and deletes carry a SHA-256 content revision — concurrent edits are rejected, never last-write-wins",
        "Documents land as direct children of the provider root through atomic writes",
      ],
      detail: "revision-checked editing",
    },
    {
      id: "app-repository",
      eyebrow: "/repository",
      title: "Repository",
      summary:
        "Scan a Git source, pin the clone to one immutable commit, preview skills, dry-run, then install into one or many imported Workspace.Providers.",
      points: [
        "Preview and install share the same pinned snapshot and session",
        "Per-skill, per-target results with local Skill IDs issued only after full re-verification",
        "Curated and user Discover sources; user sources accept https Git URLs only",
      ],
      detail: "one pinned Git commit",
    },
  ];

  const agentPanel = {
    points: [
      {
        title: "model routes",
        body: "Provider endpoints as tabs — nine wire protocols across CN and international providers, per-model context window, effort, and I/O types, with one-click connection testing.",
      },
      {
        title: "focus modes",
        body: "create / manage / explore / general sessions; focused modes narrow the kernel tool surface to the product allowlist, general keeps the full surface with native bash.",
      },
      {
        title: "approvals",
        body: "ask_user_question approval cards in the transcript; MCP mutations are *_propose tools that only execute after a human approves the proposal in the panel.",
      },
      {
        title: "native file picking",
        body: "Attachment buttons open the OS-native file dialog through the daemon; real paths flow into prompt attachments with daemon-side size guards and thumbnail previews.",
      },
    ],
  };

  const securityRows = [
    {
      surface: "HTTP transport",
      rule: "listens on 127.0.0.1 only; /api/health and the static SPA perform no filesystem mutation",
    },
    {
      surface: "WebUI auth",
      rule: "32-byte web token per daemon boot, delivered via URL fragment, captured to the tab’s sessionStorage, verified before the WebSocket upgrade",
    },
    {
      surface: "IPC",
      rule: "single-instance lock; runtime dir 0700 and socket 0600 (named pipe on Windows)",
    },
    {
      surface: "Paths",
      rule: "the server resolves opaque workspace / provider / skill IDs; mutations never accept caller-composed output paths",
    },
    {
      surface: "Writes",
      rule: "temp-file-plus-rename atomic commits; update and delete reject on SHA-256 revision mismatch",
    },
    {
      surface: "Repository",
      rule: "preview and install bind to one pinned clone session; installs re-verify canonical path, non-symlink SKILL.md, and frontmatter identity",
    },
    {
      surface: "MCP",
      rule: "mutations are *_propose tools producing proposals; execution runs only after human approval (stdio form is read-only)",
    },
    {
      surface: "External input",
      rule: "decoded to unknown, then Zod safeParse; incompatible snapshots project to empty, everything else fails typed",
    },
  ];

  const links = [
    { href: GITHUB_URL, label: "GitHub", note: "source, issues, and releases" },
    { href: NPM_URL, label: "npm", note: "skill-creator on the registry" },
    { href: JIXOAI_URL, label: "jixoai", note: "the family of projects" },
  ];
</script>

<svelte:head>
  <title>Skill Creator — a local-first workbench for Agent skills</title>
  <meta
    name="description"
    content="Skill Creator manages the full life of Agent skills on your machine: workspaces with discovery and validation, revision-checked skill editing, pinned-commit Git installs, a DSH-kernel agent panel, and an MCP surface where every mutation is a human-approved proposal."
  />
  <link rel="canonical" href={`${SITE_URL}/`} />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Skill Creator" />
  <meta property="og:title" content="Skill Creator — a local-first workbench for Agent skills" />
  <meta
    property="og:description"
    content="Workspaces, Creator, and Repository in one shell, an agent panel on a headless DSH kernel, and an MCP surface where every mutation is a human-approved proposal."
  />
  <meta property="og:url" content={`${SITE_URL}/`} />
  <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Skill Creator — a local-first workbench for Agent skills" />
  <meta
    name="twitter:description"
    content="Workspaces, Creator, and Repository in one shell, an agent panel on a headless DSH kernel, and an MCP surface where every mutation is a human-approved proposal."
  />
  <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />
</svelte:head>

<!-- Color Symbol 门面记号（resources/README：官网门面优先全彩渐变版）。 -->
<div
  class="mx-auto flex w-full max-w-[90rem] justify-center px-4 pt-10 sm:px-6 lg:px-8"
  data-reveal=""
>
  <img
    src={`${base}/logo-color.png`}
    alt="Skill Creator"
    class="h-20 w-20"
    width="80"
    height="80"
    decoding="async"
  />
</div>

<HeroSection
  eyebrow="Skill Creator"
  summary="Skill Creator is a local-first workbench for Agent skills. A thin CLI manages a single daemon; the daemon serves one shell with three apps — Workspaces, Creator, Repository — plus an agent panel on a headless DSH kernel. Skills are discovered, validated, and installed through the ccski SDK; every mutation from an agent arrives as a proposal that a human approves."
  copyCommand="npm install -g skill-creator"
  copyLabel="copy install command"
>
  {#snippet title()}
    A local-first workbench for <em>Agent skills</em>
  {/snippet}
  {#snippet badges()}
    <span>CLI + single daemon</span>
    <span>three apps · one shell</span>
    <span>DSH headless kernel</span>
    <span>MCP capability surface</span>
    <span>Node ≥ 24</span>
  {/snippet}
  {#snippet secondary()}
    <PressButton variant="outline" href={GITHUB_URL}>GitHub ↗</PressButton>
  {/snippet}
  {#snippet terminal()}
    <TerminalCard
      barTitle="skill-creator"
      command="skill-creator start"
      outputs={[
        "daemon up · loopback http · ipc lock held",
        "webui mounted · 32-byte token minted",
        "tray: mounted · window shown (app mode)",
        "ready · /workspaces /creator /repository",
      ]}
    />
  {/snippet}
</HeroSection>

<!-- Screenshot strip: the real UI under the hero narrative. -->
<div class="mx-auto w-full max-w-[90rem] px-4 pt-6 sm:px-6 lg:px-8" data-reveal="">
  <figure class="mx-auto w-full max-w-[72rem]">
    <div class="shot-frame">
      <ResponsivePicture
        set={workspacesShot as PictureSet}
        alt="Skill Creator Workspaces home screen"
        eager
      />
    </div>
    <figcaption class="shot-caption mt-2.5">
      Workspaces home — quick actions across the Global Workspace and imported workspaces (dark
      theme).
    </figcaption>
  </figure>
</div>

<!-- Three apps: the product surface (README boundary table). -->
<section id="apps" class="mx-auto w-full max-w-[90rem] px-4 pt-12 sm:px-6 lg:px-8">
  <h2 class="font-nav flex items-baseline gap-4 text-lg uppercase tracking-[0.3em]" data-reveal="">
    Three apps, one shell
    <span class="bg-border h-px flex-1" aria-hidden="true"></span>
  </h2>
  <CardGrid class="mt-6" min="340px">
    {#each apps as app (app.id)}
      <SectionCard id={app.id} eyebrow={app.eyebrow} title={app.title} summary={app.summary}>
        <!-- h-full + mt-auto: the card-grid subgrid equalizes body extents, so
             the three foot labels bottom-align across the band. -->
        <div class="flex h-full flex-col">
          <ul class="flex flex-col gap-2">
            {#each app.points as point (point)}
              <li class="text-muted-foreground flex gap-2 text-pretty text-[13px] leading-6">
                <span class="text-primary flex-none" aria-hidden="true">→</span>
                <span>{point}</span>
              </li>
            {/each}
          </ul>
          <p
            class="text-muted-foreground font-nav mt-auto pt-4 text-[12px] uppercase tracking-[0.14em]"
          >
            {app.detail}
          </p>
        </div>
      </SectionCard>
    {/each}
  </CardGrid>
</section>

<!-- Creator and Repository in the shell: real captures. -->
<section id="screens" class="mx-auto w-full max-w-[90rem] px-4 pt-12 sm:px-6 lg:px-8">
  <h2 class="font-nav flex items-baseline gap-4 text-lg uppercase tracking-[0.3em]" data-reveal="">
    In the shell
    <span class="bg-border h-px flex-1" aria-hidden="true"></span>
  </h2>
  <div class="mt-6 grid gap-6 min-[900px]:grid-cols-2">
    <figure data-reveal="">
      <div class="shot-frame">
        <ResponsivePicture
          set={creatorShot as PictureSet}
          alt="Skill Creator editor screen"
          eager
        />
      </div>
      <figcaption class="shot-caption mt-2.5">
        Creator — template drafts and revision-checked SKILL.md editing with a change log.
      </figcaption>
    </figure>
    <figure data-reveal="" style="--reveal-delay: 70ms">
      <div class="shot-frame">
        <ResponsivePicture
          set={repositoryShot as PictureSet}
          alt="Skill Creator repository screen"
          eager
        />
      </div>
      <figcaption class="shot-caption mt-2.5">
        Repository — pinned-commit scan, preview, dry-run, and multi-target install.
      </figcaption>
    </figure>
  </div>
</section>

<!-- Agent panel: kernel sessions + model routes + focus modes. -->
<section id="agent-panel" class="mx-auto w-full max-w-[90rem] px-4 pt-12 sm:px-6 lg:px-8">
  <h2 class="font-nav flex items-baseline gap-4 text-lg uppercase tracking-[0.3em]" data-reveal="">
    Agent panel
    <span class="bg-border h-px flex-1" aria-hidden="true"></span>
  </h2>
  <div class="mt-6 grid items-start gap-8 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
    <SectionCard
      eyebrow="shell-level drawer"
      title="DSH kernel sessions beside your work"
      summary="The right-hand panel hosts agent sessions on a headless DSH kernel (agent / session / llm / approval). Sessions stream frames, ask questions through approval cards, and survive tab switches; the panel resizes from 320 to 720 px and collapses without destroying the session."
    >
      <ul class="flex flex-col gap-2.5">
        {#each agentPanel.points as point (point.title)}
          <li class="border-b border-border/60 pb-2.5">
            <p class="font-nav text-primary text-[12px] uppercase tracking-[0.14em]">
              {point.title}
            </p>
            <p class="text-muted-foreground mt-1 max-w-[68ch] text-pretty text-[13px] leading-6">
              {point.body}
            </p>
          </li>
        {/each}
      </ul>
    </SectionCard>
    <figure data-reveal="" style="--reveal-delay: 90ms">
      <div class="shot-frame">
        <ResponsivePicture
          set={agentPanelShot as PictureSet}
          alt="Skill Creator agent panel"
          eager
        />
      </div>
      <figcaption class="shot-caption mt-2.5">
        Agent panel — session selector, focus-mode cards, transcript, and composer (light theme).
      </figcaption>
    </figure>
  </div>
</section>

<!-- Security model: the README boundary rows. -->
<section
  id="security"
  class="mx-auto w-full max-w-[90rem] px-4 pt-12 sm:px-6 lg:px-8"
  data-reveal=""
>
  <SectionCard
    eyebrow="security model"
    title="Local by construction, not by configuration"
    summary="Every trusting boundary in the product, listed; these rows restate the README's security section without change."
  >
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Surface</th>
            <th>Rule</th>
          </tr>
        </thead>
        <tbody>
          {#each securityRows as row (row.surface)}
            <tr>
              <td class="dim">{row.surface}</td>
              <td class="wide"><span class="measure">{row.rule}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </SectionCard>
</section>

<!-- Get started: install + requirements + links. -->
<section
  id="get-started"
  class="mx-auto w-full max-w-[90rem] px-4 pb-4 pt-12 sm:px-6 lg:px-8"
  data-reveal=""
>
  <SectionCard
    eyebrow="get started"
    title="Install globally, start once"
    summary="One CLI, one daemon. start waits for the WebUI and tray to mount, then shows the native window; web mode opens the system browser, headless prints the recovery hint."
  >
    <div class="readonly-code">
      <div class="readonly-code-meta"><span class="prompt">$</span><span>terminal</span></div>
      <pre><code
          >npm install -g skill-creator
skill-creator start
skill-creator status   # pid · version · port · tray state
skill-creator stop</code
        ></pre>
    </div>
    <div class="table-scroll mt-6">
      <table class="data-table">
        <thead>
          <tr>
            <th>Requirement</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="dim">Node.js</td>
            <td class="wide"
              ><span class="measure"
                >≥ 24.0.0 (node:zlib zstd for kernel persistence; matches the package engines field)</span
              ></td
            >
          </tr>
          <tr>
            <td class="dim">Git</td>
            <td class="wide"
              ><span class="measure">callable as <code>git</code> by the daemon process</span></td
            >
          </tr>
          <tr>
            <td class="dim">macOS / Windows</td>
            <td class="wide"
              ><span class="measure"
                >arm64 and x64 — native app window via OpenTray ext-webview (<code
                  >appMode: true</code
                >)</span
              ></td
            >
          </tr>
          <tr>
            <td class="dim">Linux</td>
            <td class="wide">
              <span class="measure">
                web mode by default: tray icon + system browser; <code>--web</code> /
                <code>--no-web</code>
                override on any platform
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ul class="mt-6 flex flex-col gap-3">
      {#each links as link (link.href)}
        <li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/60 pb-3">
          <a
            href={link.href}
            class="text-primary font-nav text-[13px] uppercase tracking-[0.14em] underline underline-offset-2"
          >
            {link.label} ↗
          </a>
          <span class="text-muted-foreground text-[13px] leading-5">{link.note}</span>
        </li>
      {/each}
    </ul>
    <p class="text-muted-foreground mt-6 max-w-[68ch] text-pretty text-[13px] leading-6">
      Development happens in the open: clone the repository and run <code>pnpm install</code>, then
      <code>pnpm dev</code>.
    </p>
  </SectionCard>
</section>
