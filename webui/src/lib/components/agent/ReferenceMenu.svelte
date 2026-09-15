<!--
  `@` 引用菜单（composer-references C1）。
  用户指示 [2026-09-16]：「继续完善遗留工作。完成 1/2/3」——官方 @ 触发（文件/
  会话引用芯片）的产品化：Sessions 组（历史会话，排除当前）+ Files 组
  （agent.files.list 目录钻取——目录行续览、`..` 上级、文件行落 `@basename`
  token）。查询含 "/" 段即纯路径浏览态（Sessions 退场）。
  正交意图：
    [1] 钻取语法：行 value = 自 home 基起的完整前缀路径（`@Dev/GitHub/`），
        与 TriggerMenu startsWith 过滤天然契合；目录行选中经 onNavigate 写回
        稿文并保持菜单（query = 新前缀）。
    [2] 数据面：files.list 按 prefix 缓存（canonical dir 由服务端 realpath）；
        sessions 惰性刷新（面板打开后新建的会话也可见）。
  妥协声明：面包屑以 `..` 上级行表达（TriggerMenu 结构行）；正式 breadcrumb
  UI 留待视觉轮。
-->
<script lang="ts">
  import TriggerMenu, { type MenuEntry, type PinnedMenuRow } from "./TriggerMenu.svelte";
  import type { ComposerReference } from "./composer-chips.js";
  import type { AgentFilesEntry } from "$shared/contracts/agent.js";
  import { agentSession, agentSessionsList, loadAgentSessions } from "$lib/stores/agent.svelte";
  import { getRpc } from "$lib/stores/connection.svelte";

  /** 选中落点：token 进稿文 + 引用进 registry（ComposerCard 接线）。token 与
   * reference.token 冗余携带（调用方不重算）。 */
  export interface ReferencePick {
    token: string;
    reference: Omit<ComposerReference, "uid">;
  }

  /** 会话/文件共用的引用构造（token 重复出现在两侧是刻意的：pick 自含）。 */
  function pickOf(
    token: string,
    reference: Omit<ComposerReference, "uid" | "token">,
  ): ReferencePick {
    return { token, reference: { ...reference, token } };
  }

  let {
    text,
    caretOnFirstLine,
    onNavigate,
    onPick,
    suppress = false,
  }: {
    /** 当前草稿全文（查询 = 首行）。 */
    text: string;
    /** 光标是否在首行（锚定条件）。 */
    caretOnFirstLine: boolean;
    /** 目录行/pinned 选中：把 @ 表达式写为 value（继续浏览）。 */
    onNavigate: (value: string) => void;
    /** 文件/会话选中：token + 引用交回 composer。 */
    onPick: (pick: ReferencePick) => void;
    /** claim 等压制透传。 */
    suppress?: boolean;
  } = $props();

  const query = $derived(text.startsWith("@") ? (text.split("\n", 1)[0] ?? "") : "");
  /** 浏览前缀（查询截到最后一个 "/"）："@Dev/Gi" → "@Dev/"；无 "/" → "@"。 */
  const browsePrefix = $derived.by(() => {
    const cut = query.lastIndexOf("/");
    return cut >= 0 ? query.slice(0, cut + 1) : "@";
  });
  const isBrowsing = $derived(browsePrefix !== "@");

  /** 会话 token label（标题为空回退短 id；长度上限防 token 失控）。 */
  function sessionLabel(title: string, sessionId: string): string {
    const base = title.trim().length > 0 ? title.trim() : sessionId.slice(0, 12);
    return base.length > 40 ? `${base.slice(0, 39)}…` : base;
  }

  /** 会话组（仅在顶层前缀）：排除当前会话（自引无意义）。 */
  const sessionEntries = $derived.by(() => {
    if (isBrowsing) return [];
    const out: MenuEntry[] = [];
    for (const session of agentSessionsList.sessions) {
      if (session.sessionId === agentSession.sessionId) continue;
      const label = sessionLabel(session.title, session.sessionId);
      out.push({ value: `@${label}`, group: "Sessions" });
    }
    return out;
  });

  /** prefix → 目录投影缓存（canonical dir + 条目；truncated 菜单层不感知）。 */
  let dirCache = $state(new Map<string, { dir: string; entries: AgentFilesEntry[] }>());
  let loading = $state(false);
  let homeDir = $state<string | null>(null);

  $effect(() => {
    // 懒加载门：稿文未以 `@` 开头不触 RPC（面板挂载不产生目录请求）。
    if (!query.startsWith("@")) return;
    // 请求时捕获前缀（promise 回调里读当前 browsePrefix 会把响应错挂到新前缀）。
    const targetPrefix = browsePrefix;
    const home = homeDir;
    void dirCache;
    if (dirCache.get(targetPrefix) !== undefined || loading) return;
    const rpc = getRpc();
    if (rpc === null) return;
    const segments = targetPrefix.slice(1).split("/").filter(Boolean);
    const dir = home === null || segments.length === 0 ? null : [home, ...segments].join("/");
    loading = true;
    rpc.agent.files
      .list(dir === null ? {} : { dir })
      .then((result) => {
        if (home === null) {
          // bootstrap 请求（list 缺省 = home）：只捕获 home 根，不入前缀缓存——
          // effect 重跑后按真实前缀请求（深层挂载场景不得把 home 条目挂到深层）。
          homeDir = result.dir;
          return;
        }
        // 过期守卫：用户已切前缀的响应不入场。
        if (targetPrefix !== browsePrefix) return;
        const next = new Map(dirCache);
        next.set(targetPrefix, { dir: result.dir, entries: result.entries });
        dirCache = next;
      })
      .catch(() => {
        if (targetPrefix !== browsePrefix) return;
        // 目标目录不存在/不可读：缓存空投影（`..` 行仍可退出）。
        const next = new Map(dirCache);
        next.set(targetPrefix, { dir: dir ?? "", entries: [] });
        dirCache = next;
      })
      .finally(() => {
        loading = false;
      });
  });

  // 会话列表惰性刷新：@ 触发即保证列表非陈旧（面板打开后的新会话可见）。
  $effect(() => {
    if (query.startsWith("@") && !agentSessionsList.loading) {
      if (!agentSessionsList.loaded) void loadAgentSessions();
      else if (agentSessionsList.error !== null) void loadAgentSessions();
    }
  });

  const fileEntries = $derived.by(() => {
    const cached = dirCache.get(browsePrefix);
    if (cached === undefined) return [];
    const out: MenuEntry[] = [];
    for (const entry of cached.entries) {
      out.push({
        value:
          entry.kind === "dir" ? `${browsePrefix}${entry.name}/` : `${browsePrefix}${entry.name}`,
        group: "Files",
      });
    }
    return out;
  });

  const entries = $derived([...sessionEntries, ...fileEntries]);

  /** pinned 上级行：非顶层恒在（钻取深度 > 0 时可退出）。 */
  const pinned = $derived.by((): PinnedMenuRow | undefined => {
    if (!isBrowsing) return undefined;
    const trimmed = browsePrefix.slice(0, -1); // 去尾 "/"
    const cut = trimmed.lastIndexOf("/");
    return { value: `${trimmed.slice(0, cut + 1)}`, label: ".." };
  });

  /** 来源副标题：浏览目录（canonical）或加载态。 */
  const sourceLabel = $derived.by(() => {
    if (loading) return "Loading directory…";
    const cached = dirCache.get(browsePrefix);
    if (cached === undefined || cached.dir.length === 0) {
      return getRpc() === null ? "Not connected" : "Files from: home";
    }
    return `Files from: ${cached.dir}`;
  });

  let menu = $state<{ handleKeydown: (event: KeyboardEvent) => boolean } | null>(null);

  /** 键盘先占透传（composer 经 bind:this 调用）。 */
  export function handleKeydown(event: KeyboardEvent): boolean {
    return menu?.handleKeydown(event) ?? false;
  }

  /** 选中路由：尾随 "/"（目录/pinned）→ 续览；命中会话 → 会话引用；否则文件。 */
  function onSelect(value: string): void {
    if (value.endsWith("/")) {
      onNavigate(value);
      return;
    }
    const session = sessionEntries.find((entry) => entry.value === value);
    if (session !== undefined) {
      const label = session.value.slice(1);
      const target = agentSessionsList.sessions.find(
        (item) =>
          sessionLabel(item.title, item.sessionId) === label &&
          item.sessionId !== agentSession.sessionId,
      );
      if (target !== undefined) {
        onPick(pickOf(session.value, { kind: "session", target: target.sessionId, label }));
        return;
      }
    }
    const cached = dirCache.get(browsePrefix);
    const name = value.slice(browsePrefix.length);
    const entry = cached?.entries.find((item) => item.kind === "file" && item.name === name);
    if (cached !== undefined && entry !== undefined) {
      const sep = cached.dir.includes("\\") ? "\\" : "/";
      onPick(
        pickOf(`@${name}`, {
          kind: "file",
          target: `${cached.dir}${sep}${name}`,
          label: name,
        }),
      );
    }
  }
</script>

<TriggerMenu
  trigger="@"
  {entries}
  {text}
  {caretOnFirstLine}
  {suppress}
  {pinned}
  menuLabel="References — files and sessions"
  {sourceLabel}
  dataSlot="reference-menu"
  emptyMessage="No matching file or session"
  {onSelect}
  bind:this={menu}
/>
