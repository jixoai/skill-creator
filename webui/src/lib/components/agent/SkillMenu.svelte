<!--
  `$` 技能引用菜单（skill-refs C1；skill-search-gui C4 切 BM25 数据源）。
  用户原始需求 [2026-09-16]：「AgentChatInput 输入要支持 `$` 开头引用 skill（类似
  `@` 的引用能力）。注意我们的 skill 是有 Workspace 概念的，所以要基于 Workspace
  分组，然后要支持模糊的搜索能力。」——与 `/name`（命令触发）语义不同：`$name`
  把技能文档作为引用注入上下文（daemon 展开为 [reference: skill …] 文本块）。
  修订 [2026-09-17]（skill-search-gui）：去全量拉取与前端子序列匹配——非空
  needle 经 debounce 走 `skills.search`（BM25 + 中文分词 + typo 容忍）；行从
  结果 installations 派生；空 needle 显示占位（916+ 技能不可浏览也不该拉）。
  修订 [2026-10-04]（workspace-page-polish V5）：分组重组——当前激活 tab 的 ws
  置顶（保留 workspace/provider 详细组头），其他 ws 的行合并为单一
  「Other workspaces」组（检索仍全局；跨 ws 引用能力保留，页面内其他 ws 数据
  收敛为折叠组）。
  正交意图：
    [1] 数据面：`$` 态 + 非空 needle → debounce(~150ms) `skills.search`；
        fetchSession 令牌在离开 `$` 态 / 清空 needle 时失效在途回调。
    [2] 分组与行：结果 × installations 派生（当前 ws 行组头 = `Workspace
        label / provider label` 反查，置顶；其余行共组 otherWorkspaces；
        同一技能多安装 = 多行同引用，key 唯一）；
        TriggerMenu 的 matcher 只承担「尾随空白即收起」的自然关闭语义。
  妥协声明：跨组同名技能并列不去重（occurrence 配对已消歧义）；检索错误保留
    已提交结果，sourceLabel 提示失败（菜单不渲染错误占位行）。
-->
<script lang="ts">
  import TriggerMenu, { type MenuEntry } from "./TriggerMenu.svelte";
  import type { ComposerReferenceInput } from "./composer-chips.js";
  import {
    installationScopeLabel,
    SEARCH_DEBOUNCE_MS,
    resetSkillSearch,
    searchSkills,
    searchState,
  } from "$lib/stores/skills.svelte";
  import { getRpc } from "$lib/stores/connection.svelte";
  import { tabSession } from "$lib/shell/tab-session.svelte.js";
  import { t } from "$lib/i18n";
  import type { SkillId } from "$shared/contracts/skills.js";
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
  /** `$` 后的检索词（trim 后非空才发检索；空 = 占位态不拉全量）。 */
  const needle = $derived(query.startsWith("$") ? query.slice(1).trim() : "");

  /** 输入去抖窗口（与 ProviderView / 命令面板共用约定）。 */

  /** 一个 installation 行：引用三元组从此派生（同一技能多安装多行同 target）。 */
  interface SkillRow {
    key: string;
    name: string;
    token: string;
    entry: MenuEntry;
    target: { workspaceId: WorkspaceId; providerId: ProviderId; skillId: SkillId };
  }

  let failure = $state<string | null>(null);
  /** 加载会话令牌：离开 `$` 态 / 清空 needle 自增，过期去抖回调不发包。 */
  let fetchSession = 0;
  /** needle 转换门：离开 `$` 态只在「曾有过检索」时作废共享 searchState。 */
  let hadNeedle = false;

  // 懒加载门：`$` 态 + 非空 needle 去抖后走 BM25 检索；断线沿 getRpc() 优雅失败
  // 先例（failure 提示，不抛错）。空 needle 只显示占位，绝不全量拉取。
  $effect(() => {
    const current = needle;
    if (!current) {
      if (hadNeedle) {
        // 离开 `$` 态：fetchSession 只挡住未发包的去抖，挡不住已发出的 RPC——
        // 经 resetSkillSearch 作废在途请求并回收共享 searchState，迟到响应
        // 被 searchRequests.invalidate 拦下，无处提交（复审边界修复）。
        resetSkillSearch();
        hadNeedle = false;
      }
      fetchSession += 1;
      failure = query.startsWith("$") && getRpc() === null ? "Not connected" : null;
      return;
    }
    hadNeedle = true;
    const session = fetchSession;
    if (getRpc() === null) {
      failure = "Not connected";
      return;
    }
    failure = null;
    const timer = setTimeout(() => {
      if (session !== fetchSession) return;
      void searchSkills(current);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  // 组件卸载（ComposerCard 随面板拆除）：同样作废在途检索——常驻实例的退出
  // 主路径是 needle 转换，这里是兜底。
  $effect(() => {
    return () => resetSkillSearch();
  });

  /** 检索态是否属于当前 needle（searchState 是全局单例，可能被其他消费方接管）。 */
  const searchFresh = $derived(searchState.query === needle);
  /** 失败投影：本地断线门（getRpc）优先，其次 store 的检索错误（仅 fresh 时归属本菜单）。 */
  const menuFailure = $derived(failure ?? (searchFresh ? searchState.error : null));
  /** 去抖窗口或在途：占位显示检索中，不闪「无匹配」；失败优先于 pending。 */
  const searchPending = $derived(
    needle !== "" && menuFailure === null && (!searchFresh || searchState.searching),
  );

  /** 当前激活 tab 的 ws id（与 Omnibox pathSuggestions 同源派生：非 ws tab = Global）。 */
  const activeWorkspaceId = $derived.by(() => {
    const tabId = tabSession.navigation.activeId;
    return tabId.startsWith("ws_") ? tabId : "~";
  });

  /**
   * 结果 × installations 派生行，按当前 tab 分区重排（V5）：当前 ws 行置顶且
   * 保留 `Workspace label / provider label` 详细组头；其他 ws 行合并为单一
   * 「Other workspaces」组（label 反查兜底 id 不变）。BM25 相对序在分区内保留。
   */
  const rows = $derived.by(() => {
    if (!needle || !searchFresh) return [];
    const own: SkillRow[] = [];
    const other: SkillRow[] = [];
    for (const result of searchState.results) {
      for (const installation of result.installations) {
        const key = `${installation.workspaceId}:${installation.providerId}:${result.id}`;
        const token = `$${result.name}`;
        const row: SkillRow = {
          key,
          name: result.name,
          token,
          entry: {
            value: token,
            description: result.description,
            group: installationScopeLabel(installation.workspaceId, installation.providerId),
            key,
          },
          target: {
            workspaceId: installation.workspaceId,
            providerId: installation.providerId,
            skillId: result.id,
          },
        };
        (installation.workspaceId === activeWorkspaceId ? own : other).push(row);
      }
    }
    if (other.length === 0) return own;
    const otherGroup = t("skillMenu.otherWorkspaces");
    return [
      ...own,
      ...other.map((row) => ({ ...row, entry: { ...row.entry, group: otherGroup } })),
    ];
  });

  const entries = $derived(rows.map((row) => row.entry));

  /** 选中路由：按 key 反查唯一行 → `$name` token + skill 作用域引用。 */
  function onSelect(value: string, entry?: MenuEntry): void {
    const row = rows.find((candidate) =>
      entry?.key !== undefined ? candidate.key === entry.key : candidate.entry.value === value,
    );
    if (row === undefined) return;
    onPick({
      token: row.token,
      reference: {
        kind: "skill",
        token: row.token,
        target: row.target.skillId,
        label: row.name,
        skill: row.target,
      },
    });
  }

  let menu = $state<{ handleKeydown: (event: KeyboardEvent) => boolean } | null>(null);

  /** 键盘先占透传（composer 经 bind:this 调用）。 */
  export function handleKeydown(event: KeyboardEvent): boolean {
    return menu?.handleKeydown(event) ?? false;
  }

  const sourceLabel = $derived.by(() => {
    if (!needle) return t("skillMenu.typeToSearch");
    if (menuFailure !== null) return menuFailure;
    if (searchPending) return t("skillMenu.searching");
    if (searchFresh && searchState.results.length > 0) {
      const groups = new Set(rows.map((row) => row.entry.group)).size;
      return t("skillMenu.resultsSummary", {
        count: searchState.results.length,
        groups,
      });
    }
    return t("skillMenu.acrossWorkspaces");
  });
</script>

<TriggerMenu
  trigger="$"
  {entries}
  {text}
  {caretOnFirstLine}
  {suppress}
  matcher={(menuQuery) => !/\s/.test(menuQuery.slice(1))}
  menuLabel={t("skillMenu.menuAria")}
  {sourceLabel}
  dataSlot="skill-menu"
  emptyMessage={menuFailure !== null
    ? t("skillMenu.searchUnavailable")
    : searchPending
      ? t("skillMenu.searching")
      : needle
        ? t("skillMenu.noMatchingSkill")
        : t("skillMenu.typeToSearchEmpty")}
  {onSelect}
  bind:this={menu}
/>
