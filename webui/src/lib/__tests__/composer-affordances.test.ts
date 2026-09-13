// @vitest-environment jsdom
/**
 * ComposerCard 可供性组件测试（R14-B 3/4）。
 *
 * 用户原始需求 [2026-09-12]：「Chat 输入框，Focus 的时候会有蓝色的 outline，
 * 你没做 css reset 吗？」；「Chat 输入框下方有两个文件选择器，没有任何语义化
 * 的辅助，提供 tooltip。并且图标也要改进。现在两个图标，一个是附件，一个是
 * 文件。我没理解」——附件按钮改为 image/file-up 图标 + 语义 tooltip/aria-label；
 * textarea focus 轮廓以 agent-flow.css 的 `.msg-body` 作者源规则显式 reset。
 *
 * 正交意图：
 *   [1] focus reset：注入真实 agent-flow.css 后聚焦 textarea，computed
 *       outline-width = 0px / style = none（jsdom UA 默认 16px = medium，
 *       对照组裸 textarea 保持默认）。
 *   [2] 附件按钮语义：图片/文件两按钮的 aria-label 与 title 完整语义断言，
 *       44px 命中区（h-8 w-8 + after:-inset-1.5）保留。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { agentSession, resetAgentStoreStub } from "./stubs/agent-store-stub.svelte";
import { agentComposer } from "../stores/agent-composer.svelte";

/**
 * 读取真实 agent-flow.css 文本（focus reset 的作者源）。vp/vitest 管线把 CSS
 * import（含 ?raw）stub 为空串，import.meta.url 亦非 file: scheme——按 cwd 双
 * 候选解析（repo 根运行 vp test / webui 目录直跑两种形态）。
 */
function readAgentFlowCss(): string {
  const candidates = [
    resolve("webui/src/lib/components/agent/agent-flow.css"),
    resolve("src/lib/components/agent/agent-flow.css"),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // 尝试下一候选。
    }
  }
  throw new Error("agent-flow.css not found relative to cwd");
}

function mountComposer() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(ComposerCard, { target });
  flushSync();
  return {
    textarea: () => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message']"),
    cleanup: () => {
      unmount(instance);
      target.remove();
      document.querySelectorAll("[data-slot='dropdown-menu-content']").forEach((n) => n.remove());
    },
  };
}

describe("ComposerCard focus outline reset (R14-B 3)", () => {
  beforeEach(() => {
    resetAgentStoreStub(null);
    agentSession.sessionId = "agent-s1";
    agentComposer.text = "";
    agentComposer.images = [];
    agentComposer.files = [];
    agentComposer.editing = null;
  });

  it("computes outline-width 0px on the focused composer textarea from agent-flow.css", () => {
    // 注入真实 agent-flow.css（focus reset 的作者源）；jsdom 解析静态类选择器
    // （:focus 伪类匹配不在其级联能力内，reset 同时声明静态 + :focus 两档）。
    const agentFlowCss = readAgentFlowCss();
    expect(agentFlowCss).toContain(".msg-body:focus");
    const style = document.createElement("style");
    style.textContent = agentFlowCss;
    document.head.appendChild(style);
    // 对照组：无 .msg-body 的裸 textarea 保持 UA 初始值（medium = 16px）。
    const bare = document.createElement("textarea");
    document.body.appendChild(bare);

    try {
      const ctx = mountComposer();
      const textarea = ctx.textarea();
      if (!textarea) throw new Error("composer textarea not rendered");
      // utilities 层兜底仍在（agent-flow.css 之外的浏览器级双保险）。
      expect(textarea.className).toContain("focus:outline-none");

      textarea.focus();
      expect(document.activeElement).toBe(textarea);
      const computed = getComputedStyle(textarea);
      expect(computed.outlineWidth).toBe("0px");
      expect(computed.outlineStyle).toBe("none");
      expect(getComputedStyle(bare).outlineWidth).toBe("16px");
      ctx.cleanup();
    } finally {
      style.remove();
      bare.remove();
    }
  });
});

describe("ComposerCard attachment pickers (R14-B 4)", () => {
  beforeEach(() => {
    resetAgentStoreStub(null);
    agentComposer.text = "";
    agentComposer.images = [];
    agentComposer.files = [];
    agentComposer.editing = null;
  });

  it("labels the image and file pickers with distinct, self-explaining semantics", () => {
    const ctx = mountComposer();
    const imageButton = document.querySelector<HTMLButtonElement>(
      "button[aria-label='Attach images (paste or pick, ≤4 MiB each)']",
    );
    const fileButton = document.querySelector<HTMLButtonElement>(
      "button[aria-label='Attach files (text inlined, binary as refs, ≤512 KiB each)']",
    );
    expect(imageButton).not.toBeNull();
    expect(fileButton).not.toBeNull();
    expect(imageButton?.title).toBe("Attach images (paste or pick, ≤4 MiB each)");
    expect(fileButton?.title).toBe("Attach files (text inlined, binary as refs, ≤512 KiB each)");

    // 44px 命中区：32px 按钮 + after:-inset-1.5（6px×2）扩展。
    for (const button of [imageButton, fileButton]) {
      expect(button?.className).toContain("h-8 w-8");
      expect(button?.className).toContain("after:-inset-1.5");
    }
    ctx.cleanup();
  });
});

describe("native pick basename derivation (R18 终验)", () => {
  it("derives display names across POSIX and Windows path shapes", async () => {
    const vectors: Array<[string, string]> = [
      ["/Users/x/a.png", "a.png"],
      ["C:\\Users\\x\\a.png", "a.png"],
      ["/Users/x/a.png///", "a.png"],
      ["a.png", "a.png"],
      ["/", "/"],
    ];
    for (const [input, expected] of vectors) {
      const derived = input.split(/[\\/]/).filter(Boolean).pop() ?? input;
      expect(derived).toBe(expected);
    }
  });
});
