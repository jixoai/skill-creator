// @vitest-environment jsdom
/**
 * ComposerCard 统一 `/` 触发菜单测试（R14-B 5 原始能力 + W3 统一迁移）。
 *
 * 用户原始需求 [2026-09-12]：「Chat 输入框中要支持补全从而输入 skill」。
 * 修订 [2026-09-16]（composer-capability-parity W3）：技能触发符从 `$` 迁至
 * `/`——单一菜单承载 Commands（roster 前）+ Skills（随后）两组；`+` 启动器
 * 无 query 全量展开；URL 剔除（`//` 与 `://`）不激发。
 *
 * 正交意图：
 *   [1] 统一候选：`/` 列命令组 + 技能组；`/x` 前缀过滤；无匹配隐藏。
 *   [2] 键盘/启动器语义：Enter 插入技能 token 或执行命令；`+` 全量展开 +
 *       Tab 选中；Esc 驳回一次；URL 剔除。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  rpc: null as unknown,
}));
const settingsUi = vi.hoisted(() => ({
  openSettings: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

vi.mock("../stores/connection.svelte", () => ({
  getRpc: () => connection.rpc ?? null,
  getConnectionGeneration: () => 0,
  requireRpc: () => {
    throw new Error("not connected");
  },
  // W1 placeholder 链消费 connectionState（composer 导入）——mock 补齐导出。
  connectionState: { status: "connected", error: null },
}));
vi.mock("../stores/agent.svelte", async () => await import("./stubs/agent-store-stub.svelte"));
// agent-composer 用真 store（runes .svelte.ts）：bind:value 与菜单的
// text 属性必须随草稿真实联动；只 mock 其依赖的 toast。
vi.mock("../toast.svelte", () => ({
  showToast: toast.showToast,
}));
vi.mock("../stores/settings-ui.svelte", () => ({
  openSettings: settingsUi.openSettings,
}));
vi.mock("../components/agent/ContextMeter.svelte", async () => {
  const { default: stub } = await import("./stubs/context-meter-stub.svelte");
  return { default: stub };
});

// @lucide/svelte 图标 = node_modules 的 .svelte（root vitest 管线不编译）——空壳替换。
vi.mock("@lucide/svelte/icons/image", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/file-up", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/arrow-up", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/square", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock(
  "@lucide/svelte/icons/chevron-down",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock("@lucide/svelte/icons/check", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/x", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/plus", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/bot", async () => await import("./stubs/lucide-icon-mocks.js"));

// bits-ui 在 node_modules 含 .svelte（vitest 外置）——本地 dropdown stub 替换。
vi.mock("$lib/components/ui/dropdown-menu", async () => {
  const Root = (await import("./stubs/dropdown-menu-pi-stub/Root.svelte")).default;
  const Trigger = (await import("./stubs/dropdown-menu-pi-stub/Trigger.svelte")).default;
  const Content = (await import("./stubs/dropdown-menu-pi-stub/Content.svelte")).default;
  const Group = (await import("./stubs/dropdown-menu-stub/Group.svelte")).default;
  const GroupHeading = (await import("./stubs/dropdown-menu-stub/GroupHeading.svelte")).default;
  const Item = (await import("./stubs/dropdown-menu-stub/Item.svelte")).default;
  const Label = (await import("./stubs/dropdown-menu-stub/Label.svelte")).default;
  const Separator = (await import("./stubs/dropdown-menu-stub/Separator.svelte")).default;
  return {
    DropdownMenu: Root,
    Trigger,
    Content,
    Group,
    GroupHeading,
    Item,
    Label,
    Separator,
  };
});

import ComposerCard from "../components/agent/ComposerCard.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
import {
  agentSession,
  resetAgentStoreStub,
  sendAgentPrompt,
} from "./stubs/agent-store-stub.svelte";
import { agentComposer } from "../stores/agent-composer.svelte";
// 真 skills store（runes .svelte.ts）：菜单的技能候选源就是它的已加载列表；
// 测试直接写 skillsState.skills（不发 RPC）。
import { skillsState } from "../stores/skills.svelte";
import { SkillMetadataSchema } from "$shared/contracts/skills.js";
import type { SkillMetadata } from "$shared/contracts/skills.js";

let fixtureSeq = 0;

/** 技能列表 fixture：经契约 schema parse 产出（branded ID 类型 + 形状即校验）。 */
function skillFixture(name: string, description = ""): SkillMetadata {
  fixtureSeq += 1;
  return SkillMetadataSchema.parse({
    id: `sk_${fixtureSeq.toString(16).padStart(24, "0")}`,
    name,
    description,
    directoryName: name,
    disabled: false,
    provider: "claude-code",
    location: "user",
    path: `/roots/claude/${name}`,
    hasReferences: false,
    hasScripts: false,
    hasAssets: false,
    pluginInfo: null,
  });
}

function mountComposer() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(ComposerCard, { target });
  flushSync();
  return {
    textarea: () => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message']"),
    menu: () => document.querySelector<HTMLElement>('[data-slot="slash-menu"]'),
    launcher: () =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Commands and skills"]'),
    cleanup: () => {
      unmount(instance);
      target.remove();
      document.querySelectorAll("[data-slot='dropdown-menu-content']").forEach((n) => n.remove());
    },
  };
}

/** 在 textarea 上派发 keydown（cancelable，preventDefault/stopPropagation 可生效）。 */
function pressKey(key: string): void {
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message']");
  if (!textarea) throw new Error("composer textarea not rendered");
  textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("ComposerCard unified `/` trigger menu (R14-B 5 + W3)", () => {
  beforeEach(() => {
    resetAgentStoreStub(null);
    agentSession.sessionId = "agent-s1";
    agentSession.mode = "free";
    agentComposer.text = "";
    agentComposer.images = [];
    agentComposer.files = [];
    agentComposer.editing = null;
    skillsState.target = null;
    skillsState.skills = [
      skillFixture("review", "Review a skill draft"),
      skillFixture("prototype", ""),
    ];
  });

  it("surfaces commands and skills as roster groups on a bare /", () => {
    const ctx = mountComposer();
    agentComposer.text = "/";
    flushSync();

    const menu = ctx.menu();
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain("Commands");
    expect(menu?.textContent).toContain("/compact");
    expect(menu?.textContent).toContain("Skills");
    expect(menu?.textContent).toContain("/review");
    expect(menu?.textContent).toContain("Review a skill draft");
    expect(menu?.textContent).toContain("/prototype");
    ctx.cleanup();
  });

  it("Enter inserts `/name ` at the caret without sending (skill pick)", () => {
    const ctx = mountComposer();
    agentComposer.text = "/rev";
    flushSync();
    expect(ctx.menu()).not.toBeNull();

    const textarea = ctx.textarea();
    if (!textarea) throw new Error("composer textarea not rendered");
    // jsdom 不会随程序化 value 赋值移动光标——显式对齐到 token 末尾。
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    pressKey("Enter");
    flushSync();

    expect(agentComposer.text).toBe("/review ");
    expect(sendAgentPrompt).not.toHaveBeenCalled();
    // 尾随空格使首行 query 脱离所有候选前缀——菜单自然收起。
    expect(ctx.menu()).toBeNull();
    ctx.cleanup();
  });

  it("Enter on the command entry executes it (commands rank first)", () => {
    const ctx = mountComposer();
    agentComposer.text = "/com";
    flushSync();
    expect(ctx.menu()).not.toBeNull();

    pressKey("Enter");
    flushSync();
    expect(sendAgentPrompt).toHaveBeenCalledWith("/compact");
    ctx.cleanup();
  });

  it("Escape dismisses once for the current draft; further typing resurfaces", () => {
    const ctx = mountComposer();
    agentComposer.text = "/";
    flushSync();
    expect(ctx.menu()).not.toBeNull();

    pressKey("Escape");
    flushSync();
    expect(ctx.menu()).toBeNull();

    agentComposer.text = "/r";
    flushSync();
    expect(ctx.menu()).not.toBeNull();
    ctx.cleanup();
  });

  it("hides the menu when nothing matches the query", () => {
    const ctx = mountComposer();
    agentComposer.text = "/xyz";
    flushSync();
    expect(ctx.menu()).toBeNull();
    ctx.cleanup();
  });

  it("URL carve-outs: protocol-relative and scheme lines never open the menu", () => {
    const ctx = mountComposer();
    agentComposer.text = "//example.com/path";
    flushSync();
    expect(ctx.menu()).toBeNull();

    agentComposer.text = "https://example.com/x";
    flushSync();
    expect(ctx.menu()).toBeNull();
    ctx.cleanup();
  });

  it("`+` launcher opens the full directory without a query; Tab picks", () => {
    const ctx = mountComposer();
    const launcher = ctx.launcher();
    if (!launcher) throw new Error("launcher button not rendered");
    launcher.click();
    flushSync();

    const menu = ctx.menu();
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain("/compact");
    expect(menu?.textContent).toContain("/review");

    // forcedOpen 态 Tab 也选中（官方 + 启动器列表盒语义）。
    pressKey("Tab");
    flushSync();
    expect(sendAgentPrompt).toHaveBeenCalledWith("/compact");
    ctx.cleanup();
  });
});
