// @vitest-environment jsdom
/**
 * 忙碌 Enter 偏好面测试（C3：Settings 行 + 响应式真相）。
 *
 * 正交意图：
 *   [1] Settings→Agent「Busy Enter」行：queue/steer 分段选择，选中即写
 *       agent-submission 的 $state 镜像 + localStorage（与 /queue //steer 同键）。
 *   [2] 响应式：偏好变化即时反映到读取面（不再依赖下一次无关重算）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const agentStore = vi.hoisted(() => ({
  agentRuntimeConfig: {
    view: null as unknown,
    loading: false,
    updating: false,
    error: null as string | null,
  },
  loadAgentSettings: vi.fn(),
  updateAgentSettings: vi.fn(),
}));

vi.mock("../stores/agent.svelte", () => agentStore);

import AgentSettingsSection from "$lib/components/settings/AgentSettingsSection.svelte";
import {
  busyEnter,
  busyEnterPreference,
  setBusyEnterPreference,
} from "$lib/stores/agent-submission.svelte";
import { flushSync, mount, unmount } from "./svelte-client";

const VIEW = {
  settings: {
    defaultMode: "free",
    preset: "live",
    permissions: { approvalPolicy: "ask" },
    model: { provider: "p", model: "m" },
    modelRoutes: [],
    session: { streamRetention: 200, streamProjection: "enabled", sessionCleanupDays: 30 },
  },
};

function mountSection() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(AgentSettingsSection, { target });
  flushSync();
  return {
    row: () => document.querySelector<HTMLElement>('[aria-label="Busy Enter"]'),
    buttons: () => [...document.querySelectorAll<HTMLElement>('[aria-label="Busy Enter"] button')],
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.removeItem("sc.composer.busyEnter");
  busyEnter.mode = "queue";
  agentStore.agentRuntimeConfig.view = VIEW;
});

describe("Busy Enter settings row (C3)", () => {
  it("renders queue/steer options with the current preference pressed", () => {
    const ctx = mountSection();
    const row = ctx.row();
    expect(row?.textContent).toContain("Queue");
    expect(row?.textContent).toContain("Steer");
    const pressed = ctx.buttons().find((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed?.textContent).toContain("Queue");
    ctx.cleanup();
  });

  it("selecting Steer writes the shared preference (state + localStorage)", async () => {
    const ctx = mountSection();
    const steer = ctx.buttons().find((button) => button.textContent?.includes("Steer"));
    steer?.click();
    await vi.waitFor(() => expect(busyEnterPreference()).toBe("steer"));
    expect(localStorage.getItem("sc.composer.busyEnter")).toBe("steer");
    const pressed = ctx.buttons().find((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed?.textContent).toContain("Steer");
    ctx.cleanup();
  });

  it("external changes (/queue command path) reflect in the settings row", async () => {
    const ctx = mountSection();
    setBusyEnterPreference("steer");
    await vi.waitFor(() => {
      const pressed = ctx
        .buttons()
        .find((button) => button.getAttribute("aria-pressed") === "true");
      expect(pressed?.textContent).toContain("Steer");
    });
    ctx.cleanup();
  });
});
