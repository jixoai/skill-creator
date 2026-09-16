<!--
  `$` 技能引用菜单（skill-refs C1）。
  用户原始需求 [2026-09-16]：「AgentChatInput 输入要支持 `$` 开头引用 skill（类似
  `@` 的引用能力）。注意我们的 skill 是有 Workspace 概念的，所以要基于 Workspace
  分组，然后要支持模糊的搜索能力。」——与 `/name`（命令触发）语义不同：`$name`
  把技能文档作为引用注入上下文（daemon 展开为 [reference: skill …] 文本块）。
  正交意图：
    [1] 数据面：workspace.list × 每 available provider `skills.list`（排除
        disabled——对 agent 不可用的技能引用无意义）；懒加载门同 ReferenceMenu
        （稿文以 `$` 开头才拉），离开 `$` 态即失效缓存（下次触发重拉，不陈旧）。
    [2] 分组与模糊：组头 = `Workspace label / provider label`（workspace 声明序，
        Global 在前）；组内经 composer-fuzzy 子序列加权排序。entries 按当前 query
        预过滤，TriggerMenu 的 matcher 只承担「尾随空白即收起」的自然关闭语义。
  妥协声明：跨组同名技能并列不去重（occurrence 配对已消歧义）；provider 失败
    置空组不阻塞其余组（sourceLabel 计数提示）。
-->
<script lang="ts">
  import TriggerMenu, { type MenuEntry } from "./TriggerMenu.svelte";
  import type { ComposerReferenceInput } from "./composer-chips.js";
  import { fuzzyMatch, fuzzySort } from "./composer-fuzzy.js";
  import { workspaceState, loadWorkspaces } from "$lib/stores/workspaces.svelte";
  import { getRpc } from "$lib/stores/connection.svelte";
  import type { SkillMetadata } from "$shared/contracts/skills.js";
  import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";

  /** 选中落点：与 ReferencePick 同构（token 进稿文 + 引用进 registry）。 */
  export interface SkillPick {
    token: string;
    reference: ComposerReferenceInput;
  }

  let {
    text,
    caretOnFirstLine,
    onPick,
    suppress = false,
  }: {
    /** 当前草稿全文（查询 = 首行）。 */
    text: string;
    /** 光标是否在首行（锚定条件）。 */
    caretOnFirstLine: boolean;
    /** 技能选中：token + 引用交回 composer。 */
    onPick: (pick: SkillPick) => void;
    /** claim 等压制透传。 */
    suppress?: boolean;
  } = $props();

  const query = $derived(text.startsWith("$") ? (text.split("\n", 1)[0] ?? "") : "");

  /** 一个 provider 组的行数据（key 跨组同名技能唯一）。 */
  interface SkillRow {
    skill: SkillMetadata;
    workspaceId: WorkspaceId;
    providerId: ProviderId;
    entry: MenuEntry;
  }
  interface ProviderGroup {
    group: string;
    rows: SkillRow[];
  }

  /** null = 未加载（本菜单会话）；组序 = workspace 声明序。 */
  let groups = $state<ProviderGroup[] | null>(null);
  let loading = $state(false);
  let failure = $state<string | null>(null);
  /** 加载会话令牌：离开 `$` 态自增，过期响应不入场。 */
  let fetchSession = 0;

  // 懒加载门 + 会话失效：稿文以 `$` 开头才拉；离开 `$` 态清缓存（下次触发重拉）。
  $effect(() => {
    if (!query.startsWith("$")) {
      if (groups !== null || loading) fetchSession += 1;
      groups = null;
      failure = null;
      return;
    }
    if (groups === null && !loading) void loadSkillGroups();
  });

  async function loadSkillGroups(): Promise<void> {
    const session = fetchSession;
    const rpc = getRpc();
    if (rpc === null) {
      failure = "Not connected";
      return;
    }
    loading = true;
    try {
      // workspace 骨架：shell 级 store 已有投影就复用；空投影（未加载/出错）重拉。
      if (workspaceState.workspaces.length === 0) {
        await loadWorkspaces();
        if (session !== fetchSession) return;
      }
      const workspaces = workspaceState.workspaces;
      if (workspaces.length === 0) {
        failure = workspaceState.error ?? "No workspaces";
        groups = [];
        return;
      }
      const settled = await Promise.allSettled(
        workspaces.flatMap((workspace) =>
          workspace.providers
            .filter((provider) => provider.available)
            .map((provider) =>
              rpc.skills
                .list({
                  workspaceId: workspace.id,
                  providerId: provider.id,
                  includeDisabled: false,
                })
                .then((result) => ({ workspace, provider, skills: result.skills })),
            ),
        ),
      );
      if (session !== fetchSession) return;
      let failedProviders = 0;
      const out: ProviderGroup[] = [];
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          failedProviders += 1;
          continue;
        }
        const { workspace, provider, skills } = outcome.value;
        const header = `${workspace.label} / ${provider.label}`;
        const rows: SkillRow[] = skills.map((skill) => ({
          skill,
          workspaceId: workspace.id,
          providerId: provider.id,
          entry: {
            value: `$${skill.name}`,
            description: skill.description,
            group: header,
            key: `${workspace.id}:${provider.id}:${skill.id}`,
          },
        }));
        if (rows.length > 0) out.push({ group: header, rows });
      }
      failure = failedProviders > 0 ? `${failedProviders} provider group(s) unavailable` : null;
      groups = out;
    } finally {
      if (session === fetchSession) loading = false;
    }
  }

  /** 当前 query 的预过滤 + 组内模糊排序投影（组序保持 workspace 声明序）。 */
  const entries = $derived.by(() => {
    if (groups === null) return [];
    const needle = query.slice(1);
    const out: MenuEntry[] = [];
    for (const providerGroup of groups) {
      const scored = providerGroup.rows
        .map((row) => ({ row, match: fuzzyMatch(needle, row.skill.name, row.skill.description) }))
        .filter((item): item is { row: SkillRow; match: { score: number } } => item.match !== null);
      for (const item of fuzzySort(scored, (entry) => entry.match.score)) {
        out.push(item.row.entry);
      }
    }
    return out;
  });

  /** 行索引（key 反查优先；value 回退兼容无 entry 的旧调用路径）。 */
  function rowOf(value: string, entry: MenuEntry | undefined): SkillRow | undefined {
    if (groups === null) return undefined;
    const rows = groups.flatMap((providerGroup) => providerGroup.rows);
    if (entry?.key !== undefined) {
      const byKey = rows.find((row) => row.entry.key === entry.key);
      if (byKey !== undefined) return byKey;
    }
    return rows.find((row) => row.entry.value === value);
  }

  let menu = $state<{ handleKeydown: (event: KeyboardEvent) => boolean } | null>(null);

  /** 键盘先占透传（composer 经 bind:this 调用）。 */
  export function handleKeydown(event: KeyboardEvent): boolean {
    return menu?.handleKeydown(event) ?? false;
  }

  /** 选中路由：按 key 反查唯一行 → `$name` token + skill 作用域引用。 */
  function onSelect(value: string, entry?: MenuEntry): void {
    const row = rowOf(value, entry);
    if (row === undefined) return;
    const token = `$${row.skill.name}`;
    onPick({
      token,
      reference: {
        kind: "skill",
        token,
        target: row.skill.id,
        label: row.skill.name,
        skill: {
          workspaceId: row.workspaceId,
          providerId: row.providerId,
          skillId: row.skill.id,
        },
      },
    });
  }

  const sourceLabel = $derived.by(() => {
    if (loading) return "Loading skills…";
    if (groups === null) return failure ?? "Skills across workspaces";
    const providers = groups.length;
    const skills = groups.reduce((total, providerGroup) => total + providerGroup.rows.length, 0);
    const suffix = failure !== null ? ` · ${failure}` : "";
    return `${skills} skills · ${providers} provider groups${suffix}`;
  });
</script>

<TriggerMenu
  trigger="$"
  {entries}
  {text}
  {caretOnFirstLine}
  {suppress}
  matcher={(menuQuery) => !/\s/.test(menuQuery.slice(1))}
  menuLabel="Skills — across workspaces"
  {sourceLabel}
  dataSlot="skill-menu"
  emptyMessage="No matching skill"
  {onSelect}
  bind:this={menu}
/>
