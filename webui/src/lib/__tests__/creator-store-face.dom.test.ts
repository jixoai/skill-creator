// @vitest-environment jsdom
/**
 * Creator store 列面 dom 测试（creator-skill-store 批 2 / tasks 批 2 第 3 行）。
 *
 * 用户原始需求 [2026-10-09]（proposal）：「……通过 ccski-sdk 将这些 skill 安装到
 * 本地 agent skills 目录……比方说……直接把技能放在 .agents/skills 目录，这属于
 * 我们可以自动化做到事情。」
 *
 * 正交意图：
 *   [1] 状态角标钉：已应用 N 处 / 未应用 / 已过期 三态按 status RPC 投影渲染。
 *   [2] 应用选择面钉：默认勾选 = 开放标准组（~/.agents/skills）；其余 root 不勾；
 *       Apply 携带所选 targets（代表 provider target）。
 *   [3] delete-origin 确认闸钉：有应用面时列出剩余应用 roots；确认走 revision 闸。
 */
import { flushSync, mount, unmount } from "./svelte-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../stores/connection.svelte",
  async () => await import("./stubs/connection-store-stub.svelte"),
);
// 本仓 vitest 管线把裸 "svelte" 解析到 server 入口——mount 用直连 client 入口，
// 两份 runtime 的 component_context 分裂会让组件内 setContext 抛
// lifecycle_outside_component；统一重定向到 client 入口（与 svelte-client.ts 同法）。
// @ts-expect-error -- 无类型声明的运行时直连（与 svelte-client.ts 同法）
vi.mock("svelte", async () => await import("../../../node_modules/svelte/src/index-client.js"));

vi.mock("../shell/portal-context.svelte", async () => {
  const { shellRouteState } = await import("./stubs/shell-route-stub.svelte");
  return {
    useParams:
      <T>() =>
      () =>
        shellRouteState.params as T,
    useSearch:
      <T>() =>
      () =>
        shellRouteState.search as T,
    useRoute: () => undefined,
    useApp: () => undefined,
  };
});
vi.mock("$app/state", () => ({
  page: {
    url: {
      pathname: "/w/ws_0123456789abcdef01234567/creator/store",
      search: "",
      searchParams: new URLSearchParams(),
    },
    params: {},
  },
}));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("../toast.svelte", () => ({ showToast: vi.fn() }));

import CreatorStore from "../apps/creator/CreatorStore.svelte";
import { workspaceState } from "../stores/workspaces.svelte";
import { connectMockClient, resetConnectionStub } from "./stubs/connection-store-stub.svelte";
import { shellRouteState } from "./stubs/shell-route-stub.svelte";
import { showToast } from "../toast.svelte";

const WS = "ws_0123456789abcdef01234567";
const HOME_AGENTS = "/home/tester/.agents/skills";
const HOME_CODEX = "/home/tester/.codex/skills";
const WS_AGENTS = "/tmp/lab-ws/.agents/skills";
const REVISION_A = `sha256:${"a".repeat(64)}`;
const HASH_A = "a".repeat(64);

function skillRow(directoryName: string, overrides: Record<string, unknown> = {}) {
  return {
    skillId: `sk_${directoryName.padEnd(24, "0").slice(0, 22)}`,
    name: directoryName,
    description: `Skill ${directoryName}.`,
    directoryName,
    revision: REVISION_A,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** status mock：applied root 携带 entityRevision（与 store hash 对比驱动 outdated）。 */
function statusMock(input: { directoryName: string }) {
  if (input.directoryName === "applied-skill") {
    return {
      skill: {
        ...skillRow("applied-skill"),
        appliedRoots: [{ scope: "global", entityRevision: HASH_A, roots: [HOME_AGENTS] }],
        outdated: false,
      },
      storeHash: HASH_A,
    };
  }
  if (input.directoryName === "stale-skill") {
    return {
      skill: {
        ...skillRow("stale-skill"),
        appliedRoots: [
          { scope: "global", entityRevision: "c".repeat(64), roots: [HOME_AGENTS, HOME_CODEX] },
        ],
        outdated: true,
      },
      storeHash: HASH_A,
    };
  }
  return {
    skill: { ...skillRow(input.directoryName), appliedRoots: [], outdated: false },
    storeHash: HASH_A,
  };
}

function makeRpcMock() {
  return {
    workspace: {
      list: vi.fn().mockResolvedValue({
        workspaces: [
          {
            id: "~",
            kind: "global",
            label: "Global Workspace",
            path: null,
            active: false,
            available: true,
            skillCount: 0,
            providers: [
              {
                id: "eve",
                label: "Eve",
                path: null,
                available: false,
                writable: false,
                skillCount: 0,
              },
              {
                id: "cline",
                label: "Cline",
                path: HOME_AGENTS,
                available: true,
                writable: false,
                skillCount: 1,
              },
              {
                id: "dexto",
                label: "Dexto",
                path: HOME_AGENTS,
                available: true,
                writable: false,
                skillCount: 1,
              },
              {
                id: "codex",
                label: "Codex",
                path: HOME_CODEX,
                available: true,
                writable: false,
                skillCount: 0,
              },
            ],
          },
          {
            id: WS,
            kind: "directory",
            path: "/tmp/lab-ws",
            label: "Lab",
            active: true,
            available: true,
            skillCount: 0,
            providers: [
              {
                id: "cursor",
                label: "Cursor",
                path: WS_AGENTS,
                available: true,
                writable: true,
                skillCount: 0,
              },
            ],
          },
        ],
      }),
    },
    creatorStore: {
      list: vi.fn().mockResolvedValue({
        skills: [skillRow("applied-skill"), skillRow("stale-skill"), skillRow("fresh-skill")],
        skipped: 0,
      }),
      status: vi.fn().mockImplementation(statusMock),
      apply: vi.fn().mockResolvedValue({
        kind: "result",
        results: [
          {
            target: { workspaceId: "~", providerId: "cline" },
            root: HOME_AGENTS,
            path: `${HOME_AGENTS}/fresh-skill`,
            status: "applied",
            mode: "link",
            entity: "created",
          },
        ],
        applied: 1,
        unchanged: 0,
        failed: 0,
      }),
      sync: vi.fn(),
      uninstall: vi.fn(),
      remove: vi.fn().mockResolvedValue({ removed: true, remainingApplications: [] }),
    },
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

let target: HTMLElement | null = null;

beforeEach(() => {
  resetConnectionStub();
  shellRouteState.params = { wsId: WS };
  shellRouteState.search = {};
  workspaceState.workspaces = [];
  vi.mocked(showToast).mockClear();
  target = document.body.appendChild(document.createElement("div"));
});

describe("creator store face status badges (creator-skill-store 批 2)", () => {
  it("renders applied / not-applied / outdated badges from the status RPC", async () => {
    const rpc = makeRpcMock();
    connectMockClient(rpc as unknown as Record<string, unknown>);
    const instance = mount(CreatorStore, { target: target as HTMLElement });
    await flushAsync();

    expect(rpc.creatorStore.list).toHaveBeenCalled();
    expect(rpc.creatorStore.status).toHaveBeenCalledTimes(3);

    const badgeOf = (directory: string): string | null =>
      target
        ?.querySelector(`[data-directory="${directory}"] [data-testid="store-status-badge"]`)
        ?.textContent?.trim() ?? null;

    expect(badgeOf("applied-skill")).toContain("Applied to 1 scope");
    expect(badgeOf("fresh-skill")).toContain("Not applied");
    // outdated 角标只在过期行呈现。
    expect(
      target?.querySelector('[data-directory="stale-skill"] [data-testid="store-outdated-badge"]'),
    ).not.toBeNull();
    expect(
      target?.querySelector(
        '[data-directory="applied-skill"] [data-testid="store-outdated-badge"]',
      ),
    ).toBeNull();
    // 未应用行的 Sync 禁用；已应用行可用。
    expect(
      (
        target?.querySelector(
          '[data-directory="fresh-skill"] [data-store-sync]',
        ) as HTMLButtonElement | null
      )?.disabled,
    ).toBe(true);
    expect(
      (
        target?.querySelector(
          '[data-directory="applied-skill"] [data-store-sync]',
        ) as HTMLButtonElement | null
      )?.disabled,
    ).toBe(false);

    unmount(instance);
  });
});

describe("creator store apply dialog (roots multi-select)", () => {
  it("checks only the open-standard root by default and sends the selected targets", async () => {
    const rpc = makeRpcMock();
    connectMockClient(rpc as unknown as Record<string, unknown>);
    const instance = mount(CreatorStore, { target: target as HTMLElement });
    await flushAsync();

    (
      target?.querySelector('[data-directory="fresh-skill"] [data-store-apply-open]') as HTMLElement
    )?.click();
    flushSync();

    const dialog = target?.querySelector('[data-testid="store-apply-dialog"]');
    expect(dialog).not.toBeNull();

    // 默认勾选：开放标准组（globalPath === ".agents/skills" 的 cline/dexto 归并
    // 为同一 root 组）；codex 与 Imported ws root 不勾。root 去重：cline/dexto
    // 同 root 只出现一个选项。
    const options = [...(dialog?.querySelectorAll('[data-testid="apply-target-option"]') ?? [])];
    const roots = options.map((option) => option.getAttribute("data-root"));
    expect(roots).toEqual([HOME_AGENTS, HOME_CODEX, WS_AGENTS]);
    const checkedOf = (root: string): boolean | undefined =>
      (
        dialog?.querySelector(
          `[data-root="${root}"] input[type="checkbox"]`,
        ) as HTMLInputElement | null
      )?.checked;
    expect(checkedOf(HOME_AGENTS)).toBe(true);
    expect(checkedOf(HOME_CODEX)).toBe(false);
    expect(checkedOf(WS_AGENTS)).toBe(false);

    // 增选 codex 后 Apply：targets = [代表(cline), codex]。
    (
      dialog?.querySelector(
        `[data-root="${HOME_CODEX}"] input[type="checkbox"]`,
      ) as HTMLInputElement | null
    )?.click();
    flushSync();
    (dialog?.querySelector("[data-store-apply-run]") as HTMLElement)?.click();
    await flushAsync();

    expect(rpc.creatorStore.apply).toHaveBeenCalledWith({
      directoryName: "fresh-skill",
      targets: [
        { workspaceId: "~", providerId: "cline" },
        { workspaceId: "~", providerId: "codex" },
      ],
    });
    // 应用后该行 status 刷新（角标更新路径）。
    expect(
      rpc.creatorStore.status.mock.calls.filter(([input]) => input.directoryName === "fresh-skill")
        .length,
    ).toBeGreaterThanOrEqual(2);

    unmount(instance);
  });
});

describe("creator store delete-origin confirm gate", () => {
  it("lists remaining applied roots and deletes through the revision gate", async () => {
    const rpc = makeRpcMock();
    connectMockClient(rpc as unknown as Record<string, unknown>);
    const instance = mount(CreatorStore, { target: target as HTMLElement });
    await flushAsync();

    (
      target?.querySelector('[data-directory="applied-skill"] [data-store-delete]') as HTMLElement
    )?.click();
    flushSync();

    const confirm = target?.querySelector('[data-testid="store-delete-confirm"]');
    expect(confirm).not.toBeNull();
    // 确认闸列出剩余应用面（已应用副本不随根源删除）。
    const remaining = [
      ...(confirm?.querySelectorAll('[data-testid="delete-remaining-root"]') ?? []),
    ].map((item) => item.getAttribute("title"));
    expect(remaining).toEqual([HOME_AGENTS]);

    (confirm?.querySelector("[data-store-delete-confirm]") as HTMLElement)?.click();
    await flushAsync();

    // revision 闸 = status 面的 skill.revision。
    expect(rpc.creatorStore.remove).toHaveBeenCalledWith({
      directoryName: "applied-skill",
      expectedRevision: REVISION_A,
    });
    // 删除后列表刷新。
    expect(rpc.creatorStore.list.mock.calls.length).toBeGreaterThanOrEqual(2);

    unmount(instance);
  });
});
