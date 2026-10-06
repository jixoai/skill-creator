/**
 * SkillDetail 独立路由的列表态回传（skills-tabs-redesign 批 2，design.md Δ3 定稿）。
 *
 * 用户原始需求 [2026-10-06]：「`?from=` 白名单 `{tab,q,p,dup,scroll,sel,file}`，
 * 编码后 ≤512 字符，未知/重复键静默丢弃，枚举校验，回程经状态对象重组 route
 * （禁止字符串拼 href）；detail 返回完整还原列表筛选/滚动；浏览器原生 back 并存」。
 * 修订 [2026-10-06]（MainAgent 复核裁决）：`p` = provider chip 筛选（fuse2 基线
 * returnProvider 语义——用户带 provider 筛选进 detail，显式返回必须完整还原该
 * 筛选与行集，裁决表 #4 要防的状态丢失）；分页段数改 `page` 键承载，消除歧义。
 *
 * 正交意图：
 *   [1] 列表态快照编码：detail 深链携带 `?from=`（URLSearchParams 单层编码），
 *       白名单外键与重复键丢弃、枚举/形状校验失败静默落默认（不报错）。
 *   [2] 回程重组：decode 出状态对象 → 经 goById 的 search 对象重建路由
 *       （tab/q/dup/p(provider) 进 URL——provider 即 dashboard 的 chip 激活真相；
 *       scroll/sel/page 经同源 handoff 内存面还原——不进 URL）。
 * 妥协声明：编码器（构建侧保证 ≤512）与解码器（total、永不 throw）是同一份
 * 白名单契约的两面，拆文件会让键集漂移；两意图同文件可接受。
 */
import type { SkillId } from "$shared/contracts/skills.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { ProviderIdSchema, type ProviderId } from "$shared/contracts/workspaces.js";

/** `from=` 携带的列表态白名单键（Δ3 冻结 + MainAgent 裁决的 page 附加键；未知键 = 丢弃）。 */
export interface SkillsListState {
  /** 回程 Tab（detail 只从 Skills 列表进入；保留键位以还原跨 Tab 深链）。 */
  tab: "skills" | "agents" | "repos";
  /** 列表搜索词（"" = 无）。 */
  q: string;
  /** Provider chip 筛选（`p` 键；null = All）。 */
  provider: ProviderId | null;
  /** duplicates-only 过滤开关。 */
  dup: boolean;
  /** 已加载页数（load-more 段数；`page` 键承载，1 = 仅首页）。 */
  page: number;
  /** 列表滚动位置（px）。 */
  scroll: number;
  /** 焦点/选中行的组代表 skillId（wellformed 才入键）。 */
  sel: SkillId | null;
  /** detail 内文件深链（批 3 文件树消费；本批仅白名单回传）。 */
  file: string;
}

export const DEFAULT_LIST_STATE: SkillsListState = {
  tab: "skills",
  q: "",
  provider: null,
  dup: false,
  page: 1,
  scroll: 0,
  sel: null,
  file: "",
};

/** 编码后 `from` 值的上限（Δ3：编码 ≤512 字符，超限整键丢弃）。 */
const FROM_PARAM_MAX_CHARS = 512;
/** file 路径键上限（批 3 消费前的传输护栏）。 */
const FROM_FILE_MAX_CHARS = 256;
/** page 的上限（listCanonical limit 上限 500 的段数护栏）。 */
const FROM_PAGES_MAX = 500;

const TAB_VALUES = new Set(["skills", "agents", "repos"]);

/**
 * 编码列表态为 `from` 值（构建侧契约：返回值恒 ≤512 字符；默认值省略键位）。
 * 超限返回 undefined（整键丢弃，不截断半截状态）。
 */
export function encodeListStateParam(state: SkillsListState): string | undefined {
  const params = new URLSearchParams();
  if (state.tab !== DEFAULT_LIST_STATE.tab) params.set("tab", state.tab);
  if (state.q !== "") params.set("q", state.q);
  if (state.provider) params.set("p", state.provider);
  if (state.dup) params.set("dup", "1");
  if (state.page !== DEFAULT_LIST_STATE.page) params.set("page", String(state.page));
  if (state.scroll > 0) params.set("scroll", String(state.scroll));
  if (state.sel) params.set("sel", state.sel);
  if (state.file !== "") params.set("file", state.file);
  const encoded = params.toString();
  if (encoded.length > FROM_PARAM_MAX_CHARS) return undefined;
  return encoded === "" ? undefined : encoded;
}

/**
 * 解码 `from` 值为列表态（total：非法/未知/重复键一律静默落默认或丢弃首个后的
 * 重复项；枚举/形状校验失败同键落默认——永不 throw）。
 */
export function parseListStateParam(value: string | null | undefined): SkillsListState {
  const state: SkillsListState = { ...DEFAULT_LIST_STATE };
  if (!value || value.length > FROM_PARAM_MAX_CHARS) return state;
  const seen = new Set<string>();
  for (const [rawKey, rawValue] of new URLSearchParams(value)) {
    if (seen.has(rawKey)) continue; // 重复键：首现即决，后续丢弃
    switch (rawKey) {
      case "tab":
        if (TAB_VALUES.has(rawValue)) {
          seen.add(rawKey);
          state.tab = rawValue as SkillsListState["tab"];
        }
        break;
      case "q":
        seen.add(rawKey);
        state.q = rawValue;
        break;
      case "p": {
        const provider = ProviderIdSchema.safeParse(rawValue);
        if (provider.success) {
          seen.add(rawKey);
          state.provider = provider.data;
        }
        break;
      }
      case "dup":
        if (rawValue === "1") {
          seen.add(rawKey);
          state.dup = true;
        }
        break;
      case "page": {
        const pages = Number.parseInt(rawValue, 10);
        if (Number.isInteger(pages) && pages >= 1 && pages <= FROM_PAGES_MAX) {
          seen.add(rawKey);
          state.page = pages;
        }
        break;
      }
      case "scroll": {
        const scroll = Number.parseInt(rawValue, 10);
        if (Number.isInteger(scroll) && scroll >= 0) {
          seen.add(rawKey);
          state.scroll = scroll;
        }
        break;
      }
      case "sel": {
        const parsed = SkillIdSchema.safeParse(rawValue);
        if (parsed.success) {
          seen.add(rawKey);
          state.sel = parsed.data;
        }
        break;
      }
      case "file":
        if (rawValue !== "" && rawValue.length <= FROM_FILE_MAX_CHARS && !rawValue.includes("\0")) {
          seen.add(rawKey);
          state.file = rawValue;
        }
        break;
      default:
        break; // 未知键：静默丢弃
    }
  }
  return state;
}

/**
 * 回程 handoff：URL 只承载筛选语义（tab/q/dup/p=provider——provider 即 dashboard
 * 的 chip 激活真相源），scroll/sel/page 经这份同源内存面还原（detail 显式返回时
 * stash，列表挂载时 consume；与旧 pendingFocusSkillId 同族但承载完整窗口态）。
 * stash 按 wsId 守卫——跨 workspace 的残留 stash 在 consume 时丢弃（不污染后来者
 * 的挂载）；冷载 detail → 返回时无 stash 亦不报错。
 */
let pendingRestore: { wsId: string; state: SkillsListState } | null = null;

export function stashSkillsListRestore(wsId: string, state: SkillsListState): void {
  pendingRestore = { wsId, state };
}

export function consumeSkillsListRestore(wsId: string): SkillsListState | null {
  const pending = pendingRestore;
  pendingRestore = null;
  return pending !== null && pending.wsId === wsId ? pending.state : null;
}

/** detail 页 onBack 的目标列表态 → dashboard search 对象（经 goById 重建，不拼 href）。 */
export function listStateToDashboardSearch(state: SkillsListState): {
  tab?: "skills" | "agents" | "repos";
  q?: string;
  provider?: ProviderId;
  duplicates?: "1";
} {
  return {
    ...(state.tab !== "skills" ? { tab: state.tab } : {}),
    ...(state.q !== "" ? { q: state.q } : {}),
    ...(state.provider ? { provider: state.provider } : {}),
    ...(state.dup ? { duplicates: "1" as const } : {}),
  };
}
