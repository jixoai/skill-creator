// @vitest-environment jsdom
/**
 * SkillDetailPage 组件级 DOM 断言（skills-tabs-redesign 批 2，design.md Δ3 定稿）。
 * 用户原始需求 [2026-10-06]：「detail 独立路由永远绑定具体 provider copy；本批
 * 范围 = 身份/元信息 + 副本组差异 + 校验 + 启停 + 操作区（文件树批 3）；
 * ?from= 回程经状态对象重组 route（不拼 href）；非法身份 typed not-found」。
 * 正交意图：
 *   [1] 数据面：页面拥有 skills.info（typed NOT_FOUND → 页级 not-found），面板
 *       外部持有模式消费；零写纪律（除 skills.toggle 外零写 RPC）。
 *   [2] 副本组差异：listCanonical q=name 精确匹配组 → copies 行（代表标记/
 *       disabled/conflict/不可用/描述差异）。
 *   [3] 回程：面包屑返回 = parse from → 状态对象经 goById 重建 dashboard route
 *       （URL 只带筛选语义；scroll/sel/p 归 handoff）。
 *   [4] 面板头部栈式布局（原 master-detail 期 P1-1 契约随宿主迁移继续有效）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount, flushSync, type Component } from "svelte";
import { ORPCError } from "@orpc/client";

let rpcClient: Record<string, unknown> | null = null;

vi.mock("$lib/stores/connection.svelte", () => ({
  connectionState: { status: "connected", error: null },
  connect: vi.fn(),
  disconnect: vi.fn(),
  getConnectionGeneration: () => 0,
  getRpc: () => rpcClient,
  requireRpc: () => {
    if (!rpcClient) throw new Error("The Skill Creator daemon is not connected.");
    return rpcClient;
  },
}));

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

vi.mock("$lib/stores/agent.svelte", () => ({
  startAgentAction: vi.fn(),
}));

vi.mock("$lib/components/ui/button", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/ui-button-stub.svelte");
  return { Button: stub };
});
vi.mock("$lib/components/ui/badge", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/ui-badge-stub.svelte");
  return { Badge: stub };
});

// manifest 注册（goById 构 href 需要 routeRegistry）。
import "../../workspaces/manifest.js";
import { setNavControllerAdapter } from "$lib/shell/navigate.js";
import { workspaceState } from "$lib/stores/workspaces.svelte";
import { clearUpdateReport } from "$lib/stores/skills-update.svelte";
import { SkillIdSchema, type SkillId, type SkillInfo } from "$shared/contracts/skills.js";
import { ImportedWorkspaceIdSchema, ProviderIdSchema } from "$shared/contracts/workspaces.js";
import type { SkillsCanonicalGroup } from "$shared/rpc-contract.js";
import SkillDetailPageHarness from "./skill-detail-page-harness.svelte";

const WS = ImportedWorkspaceIdSchema.parse("ws_0123456789abcdef01234567");
const SK = SkillIdSchema.parse(`sk_0123456789abcdef01234567`);
const SK_COPY = SkillIdSchema.parse(`sk_${"9".repeat(24)}`);
const CLAUDE = ProviderIdSchema.parse("claude-code");
const ZCODE = ProviderIdSchema.parse("zcode");

function skillInfo(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    id: SK,
    name: "alpha",
    description: "alpha desc",
    directoryName: "alpha",
    disabled: false,
    provider: "claude-code",
    location: "user",
    path: `/ws/alpha`,
    hasReferences: false,
    hasScripts: false,
    hasAssets: false,
    pluginInfo: null,
    installedVia: "unknown",
    updatable: false,
    size: 128,
    content: "---\nname: alpha\ndescription: alpha desc\n---\n\n# Body\n",
    revision: `sha256:${"0".repeat(64)}`,
    ...overrides,
  };
}

function copyOf(
  skillId: SkillId,
  providerId: typeof CLAUDE | typeof ZCODE,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: skillId,
    skillId,
    workspaceId: WS,
    providerId,
    name: "alpha",
    description: "alpha desc",
    directoryName: "alpha",
    disabled: false,
    provider: providerId,
    location: "user" as const,
    path: `/ws/${providerId}/alpha`,
    hasReferences: false,
    hasScripts: false,
    hasAssets: false,
    pluginInfo: null,
    installedVia: "unknown" as const,
    updatable: false,
    unavailable: false,
    conflict: false,
    ...overrides,
  };
}

function copiesGroup(overrides: Partial<SkillsCanonicalGroup> = {}): SkillsCanonicalGroup {
  const copies = [
    copyOf(SK, CLAUDE),
    copyOf(SK_COPY, ZCODE, { disabled: true, description: "zcode variant desc" }),
  ];
  return {
    name: "alpha",
    description: "alpha desc",
    representative: copies[0]!,
    copies,
    groupMeta: { copyCount: 2, allUnavailable: false },
    ...overrides,
  };
}

interface RpcLog {
  calls: string[];
  navigate: string[];
}

function makeRpcLog(): RpcLog {
  return { calls: [], navigate: [] };
}

function installRpc(
  log: RpcLog,
  options: {
    info?: SkillInfo;
    infoError?: InstanceType<typeof ORPCError>;
    group?: SkillsCanonicalGroup | null;
  } = {},
): void {
  rpcClient = {
    skills: {
      info: (input: Record<string, unknown>) => {
        log.calls.push(`skills.info:${input.skillId ?? ""}`);
        if (options.infoError) return Promise.reject(options.infoError);
        return Promise.resolve(options.info ?? skillInfo());
      },
      list: (input: Record<string, unknown>) => {
        log.calls.push(`skills.list:${input.providerId ?? ""}`);
        return Promise.resolve({ skills: [] });
      },
      listCanonical: (input: Record<string, unknown>) => {
        log.calls.push(`skills.listCanonical:${JSON.stringify(input)}`);
        const group = options.group ?? copiesGroup();
        return Promise.resolve({
          providers: [],
          groups: group === null ? [] : [group],
          groupCount: group === null ? 0 : 1,
          copyCount: group === null ? 0 : group.groupMeta.copyCount,
        });
      },
      validate: () => {
        log.calls.push("skills.validate:");
        return Promise.resolve({ success: true, errors: [], warnings: [] });
      },
      toggle: (input: Record<string, unknown>) => {
        log.calls.push(`skills.toggle:${JSON.stringify(input)}`);
        const skillIds = input.skillIds as string[] | undefined;
        return Promise.resolve({
          results: [{ skillId: skillIds?.[0], name: "alpha", status: "disabled" }],
        });
      },
      search: () => Promise.resolve({ results: [] }),
      duplicates: () => Promise.resolve({ groups: [] }),
      searchConfig: { open: () => Promise.resolve({ opened: true }) },
      update: {
        check: () => {
          log.calls.push("skills.update.check");
          return Promise.resolve({ results: [] });
        },
      },
    },
    repository: {
      sources: { list: () => Promise.resolve({ builtIn: [], user: [] }) },
    },
    selfSkill: { state: () => Promise.resolve({ state: "ok" }) },
    workspace: { list: () => Promise.resolve({ workspaces: [] }) },
  };
}

function seedImportedWorkspace(): void {
  workspaceState.workspaces = [
    {
      id: WS,
      label: "Imported WS",
      kind: "directory",
      active: true,
      available: true,
      skillCount: 2,
      path: "/tmp/ws",
      providers: [
        {
          id: "claude-code",
          label: "Claude Code",
          path: "/tmp/ws/.claude/skills",
          available: true,
          writable: true,
          skillCount: 2,
        },
        {
          id: "zcode",
          label: "ZCode",
          path: "/tmp/ws/.zcode/skills",
          available: true,
          writable: true,
          skillCount: 1,
        },
      ],
    },
  ] as unknown as typeof workspaceState.workspaces;
}

const mounted: ReturnType<typeof mount>[] = [];

function mountPage(search: Record<string, unknown> = {}): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const Harness = SkillDetailPageHarness as unknown as Component;
  mounted.push(
    mount(Harness, {
      target,
      props: { wsId: WS, providerId: "claude-code", skillId: SK, search },
    }),
  );
  return target;
}

function settle(ms = 40): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buttons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll("button")];
}

function click(button: HTMLElement | null | undefined): void {
  if (!button) throw new Error("button not found");
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function textOf(root: HTMLElement): string {
  return (root.textContent ?? "").replace(/\s+/g, " ").trim();
}

let activeLog: RpcLog | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  seedImportedWorkspace();
  setNavControllerAdapter({
    navigate: (path: string) => {
      activeLog?.navigate.push(path);
    },
  });
});

afterEach(async () => {
  while (mounted.length > 0) {
    const instance = mounted.pop();
    if (instance) await unmount(instance);
  }
  activeLog = null;
  setNavControllerAdapter({
    navigate: () => {
      /* 测试间空适配器 */
    },
  });
  workspaceState.workspaces = [];
  clearUpdateReport();
  rpcClient = null;
});

describe("SkillDetailPage（批 2 Δ3 独立路由页）", () => {
  it("renders identity/meta via the page-owned info and keeps the zero-write discipline", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log);
    const root = mountPage();
    await settle();

    // 身份/元信息（页面持有 info；面板外部持有模式渲染标题/描述）。
    expect(log.calls.some((call) => call.startsWith("skills.info:"))).toBe(true);
    expect(textOf(root)).toContain("alpha");
    // 副本组差异经 listCanonical 精确组（q=name）。
    expect(log.calls.some((call) => call.includes("skills.listCanonical"))).toBe(true);
    // 零写纪律：无 creator.*、无 repository 写面、无 skills.toggle（点击前）。
    const forbidden = log.calls.filter(
      (call) =>
        call.startsWith("creator.") ||
        /^repository\.(scan|preview|install)/.test(call) ||
        call.startsWith("skills.toggle"),
    );
    expect(forbidden).toEqual([]);

    // Toggle = skills 域唯一写 RPC；Validate 只读面。
    const toggle = buttons(root).find((b) => textOf(b) === "Disable");
    expect(toggle).toBeDefined();
    click(toggle);
    await settle(120);
    expect(log.calls.some((call) => call.startsWith("skills.toggle:"))).toBe(true);
    // toggle 后页面重拉 info（onRefresh 外部持有模式）。
    expect(log.calls.filter((call) => call.startsWith("skills.info:")).length).toBeGreaterThan(1);

    click(buttons(root).find((b) => textOf(b) === "Validate"));
    await settle(120);
    expect(log.calls.some((call) => call.startsWith("skills.validate:"))).toBe(true);
    expect(
      log.calls.filter(
        (call) => call.startsWith("creator.") || /^repository\.(scan|preview|install)/.test(call),
      ),
    ).toEqual([]);
  });

  it("renders the typed not-found page when skills.info rejects NOT_FOUND", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, { infoError: new ORPCError("NOT_FOUND", { message: "Skill not found" }) });
    const root = mountPage();
    await settle();

    expect(root.querySelector('[data-testid="skill-not-found"]')).not.toBeNull();
    // not-found 页携带回 Skills 出口。
    const back = buttons(root).find((b) =>
      (b.getAttribute("aria-label") ?? "").includes("Back to Skills"),
    );
    expect(back).toBeDefined();
  });

  it("shows the copies section with representative/disabled/description-diff marks", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log);
    const root = mountPage();
    await settle();

    const section = root.querySelector('[aria-label="Copies in this workspace"]');
    expect(section).not.toBeNull();
    expect(textOf(section as HTMLElement)).toContain("×2");
    // 代表标记落在 claude-code copy；zcode copy 携带 disabled 标记 + 描述差异。
    const rows = [...(section as HTMLElement).querySelectorAll("button")];
    expect(rows).toHaveLength(2);
    expect(textOf(rows[0] as HTMLElement)).toContain("Representative");
    expect(textOf(rows[1] as HTMLElement)).toContain("Disabled");
    expect(textOf(rows[1] as HTMLElement)).toContain("zcode variant desc");

    // 副本行点击 = 路由到该 copy 的 detail（from 原样保留）。
    click(rows[1]);
    expect(log.navigate).toHaveLength(1);
    const url = new URL(log.navigate[0] as string, "https://skill-creator.invalid");
    expect(url.pathname).toBe(`/w/${WS}/skills/zcode/${SK_COPY}`);
  });

  it("rebuilds the list route from the ?from= state object on explicit back (no href string)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log);
    // p = provider 筛选（MainAgent 裁决），分页段数走 page 键。
    const from = new URLSearchParams({
      q: "vue",
      p: "zcode",
      page: "3",
      dup: "1",
      scroll: "420",
      sel: SK,
    });
    const root = mountPage({ from: from.toString() });
    await settle();

    const back = root.querySelector<HTMLButtonElement>('button[aria-label="Back to Skills"]');
    expect(back).not.toBeNull();
    click(back);
    expect(log.navigate).toHaveLength(1);
    const url = new URL(log.navigate[0] as string, "https://skill-creator.invalid");
    // 状态对象重组：URL 只承载筛选语义（q/dup/provider——provider 即 chip 激活
    // 真相源）；scroll/sel/page 归 handoff。
    expect(url.pathname).toBe(`/w/${WS}/skills`);
    expect(url.searchParams.get("q")).toBe("vue");
    expect(url.searchParams.get("provider")).toBe("zcode");
    expect(url.searchParams.get("duplicates")).toBe("1");
    expect(url.searchParams.has("scroll")).toBe(false);
    expect(url.searchParams.has("sel")).toBe(false);
    expect(url.searchParams.has("page")).toBe(false);

    // handoff 面持有完整窗口态（scroll/sel/page 供列表挂载还原）。
    const { consumeSkillsListRestore } = await import("../skill-detail-route.js");
    const restored = consumeSkillsListRestore(WS);
    expect(restored).toMatchObject({
      q: "vue",
      provider: ZCODE,
      page: 3,
      dup: true,
      scroll: 420,
      sel: SK,
    });
    // 跨 ws 守卫：其他 ws 消费不到。
    expect(consumeSkillsListRestore("ws_ffffffffffffffffffffffff")).toBeNull();
  });

  it("keeps the panel header stacking contract (title block above actions row)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log);
    const root = mountPage();
    await settle(80);

    const heading = root.querySelector<HTMLHeadingElement>("header h2");
    expect(heading?.textContent).toBe("alpha");
    // 标题块内没有动作按钮——文本块不与按钮同行争宽（P1-1 契约随宿主迁移继续有效）。
    const titleBlock = heading?.parentElement ?? null;
    expect(titleBlock?.querySelector("button")).toBeNull();
    const actionsRow = titleBlock?.parentElement?.nextElementSibling ?? null;
    const actionTexts = [...(actionsRow?.querySelectorAll("button") ?? [])].map((button) =>
      textOf(button as HTMLElement),
    );
    expect(actionTexts).toEqual(expect.arrayContaining(["Edit in Creator", "Validate", "Disable"]));
  });
});
