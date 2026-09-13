// @vitest-environment jsdom
/**
 * ComposerCard `$` skill 补全组件测试（R14-B 5）。
 *
 * 用户原始需求 [2026-09-12]：「Chat 输入框中要支持 `$` 来激发输入补全，从而
 * 输入 skill」——稿文以 `$` 开头且光标在首行时于 composer 上方浮现候选
 * （数据源 = skills store 已加载的当前 Workspace Provider 列表；为空显示
 * "No skills in the current workspace"）；↑↓ 循环、Enter 把 `$name ` 插回
 * 稿文光标处（不发送）、Esc 一次性驳回；`/` 命令菜单行为不回归。
 *
 * 正交意图：
 *   [1] 浮现与候选：`$` 列出 `$name` 条目、`$x` 无匹配隐藏、空技能列表占位。
 *   [2] 键盘语义：Enter 插入 token + 尾随空格（菜单自然收起、不发送）、
 *       Esc 驳回一次（再输入重新浮现）、`/` 仍走 SlashMenu。
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
}));
vi.mock("../stores/agent.svelte", async () => await import("./stubs/agent-store-stub.svelte"));
// agent-composer 用真 store（runes .svelte.ts）：bind:value 与 SkillMenu 的
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
// R17-B：附件按钮改开 FilePickerDialog（ui/dialog → bits-ui 不可编译）——空壳替换。
vi.mock("../components/agent/FilePickerDialog.svelte", async () => {
  const { default: stub } = await import("./stubs/file-picker-stub.svelte");
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
// 真 skills store（runes .svelte.ts）：SkillMenu 的候选源就是它的已加载列表；
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
    menu: () => document.querySelector<HTMLElement>('[data-slot="skill-menu"]'),
    slashMenu: () => document.querySelector<HTMLElement>('[data-slot="slash-menu"]'),
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

describe("ComposerCard `$` skill completion (R14-B 5)", () => {
  beforeEach(() => {
    resetAgentStoreStub(null);
    agentSession.sessionId = "agent-s1";
    agentSession.mode = "free";
    agentComposer.text = "";
    agentComposer.images = [];
    agentComposer.files = [];
    agentComposer.editing = null;
    // SkillMenu 只消费已加载列表（面板上下文不解析 workspace target）。
    skillsState.target = null;
    skillsState.skills = [
      skillFixture("review", "Review a skill draft"),
      skillFixture("prototype", ""),
    ];
  });

  it("surfaces `$name` candidates from the loaded workspace skills on a bare $", () => {
    const ctx = mountComposer();
    agentComposer.text = "$";
    flushSync();

    const menu = ctx.menu();
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain("$review");
    expect(menu?.textContent).toContain("Review a skill draft");
    expect(menu?.textContent).toContain("$prototype");
    expect(ctx.slashMenu()).toBeNull();
    ctx.cleanup();
  });

  it("Enter inserts `$name ` at the caret without sending", () => {
    const ctx = mountComposer();
    agentComposer.text = "$rev";
    flushSync();
    expect(ctx.menu()).not.toBeNull();

    const textarea = ctx.textarea();
    if (!textarea) throw new Error("composer textarea not rendered");
    // jsdom 不会随程序化 value 赋值移动光标——显式对齐到 token 末尾。
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    pressKey("Enter");
    flushSync();

    expect(agentComposer.text).toBe("$review ");
    expect(sendAgentPrompt).not.toHaveBeenCalled();
    // 尾随空格使首行 query 脱离所有候选前缀——菜单自然收起。
    expect(ctx.menu()).toBeNull();
    ctx.cleanup();
  });

  it("Escape dismisses once for the current draft; further typing resurfaces", () => {
    const ctx = mountComposer();
    agentComposer.text = "$";
    flushSync();
    expect(ctx.menu()).not.toBeNull();

    pressKey("Escape");
    flushSync();
    expect(ctx.menu()).toBeNull();

    agentComposer.text = "$r";
    flushSync();
    expect(ctx.menu()).not.toBeNull();
    ctx.cleanup();
  });

  it("hides the menu when no skill name matches the query", () => {
    const ctx = mountComposer();
    agentComposer.text = "$x";
    flushSync();
    expect(ctx.menu()).toBeNull();
    ctx.cleanup();
  });

  it("shows the empty-workspace placeholder and keeps Enter from sending the half token", () => {
    skillsState.skills = [];
    const ctx = mountComposer();
    agentComposer.text = "$";
    flushSync();

    const menu = ctx.menu();
    expect(menu?.textContent).toContain("No skills in the current workspace");

    pressKey("Enter");
    flushSync();
    expect(sendAgentPrompt).not.toHaveBeenCalled();
    expect(agentComposer.text).toBe("$");
    ctx.cleanup();
  });

  it("keeps the `/` slash menu as the only trigger for commands", () => {
    const ctx = mountComposer();
    agentComposer.text = "/";
    flushSync();
    expect(ctx.slashMenu()).not.toBeNull();
    expect(ctx.menu()).toBeNull();

    pressKey("Enter");
    flushSync();
    expect(sendAgentPrompt).toHaveBeenCalledWith("/compact");
    ctx.cleanup();
  });
});
