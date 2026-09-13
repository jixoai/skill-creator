// @vitest-environment jsdom
/**
 * SessionsSettingsSection 组件测试（R14-C 2026-09-12）。
 * 用户原始需求 [2026-09-12]：「要有专门的 Session 管理页面，并且要默认支持
 * 清理 30 天以外的 Session（可配置）。」
 * 正交意图：
 *   [1] 列表渲染：按日期倒序分组（组内最新在前）、标题/模式标签、running 行
 *     删除禁用、空态文案、mount 拉一次列表。
 *   [2] 删除流：行删除 → ConfirmDialog → cleanup({sessionIds})。
 *   [3] 策略保存：sessionCleanupDays 输入 dirty 解禁 Save → settings update 补丁。
 *   [4] Clean now：cleanup({beforeDays}) → deleted/kept 摘要呈现。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../stores/agent.svelte", async () => {
  const stub = await import("./stubs/sessions-store-stub.svelte");
  return {
    agentRuntimeConfig: stub.agentRuntimeConfig,
    agentSessionsList: stub.agentSessionsList,
    loadAgentSessions: stub.loadAgentSessions,
    loadAgentSettings: stub.loadAgentSettings,
    updateAgentSettings: stub.updateAgentSettings,
    cleanupAgentSessions: stub.cleanupAgentSessions,
  };
});

vi.mock("@lucide/svelte/icons/trash-2", async () => await import("./stubs/lucide-icon-mocks.js"));

// bits-ui 在 node_modules 含 .svelte（vitest 外置）——ConfirmDialog 以同 props
// 契约的本地 stub 替换（open 门控 + 确认/取消行为一致）。
vi.mock("../components/confirm-dialog.svelte", async () => {
  const { default: stub } = await import("./stubs/confirm-dialog-stub.svelte");
  return { default: stub };
});

import SessionsSettingsSection from "../components/settings/SessionsSettingsSection.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
import {
  resetSessionsStoreStub,
  updateAgentSettings,
  cleanupAgentSessions,
  loadAgentSessions,
} from "./stubs/sessions-store-stub.svelte";
import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";
import type { AgentSessionSummary } from "$shared/contracts/agent.js";

function baseView(cleanupDays = 30): DshStewardSettingsView {
  return {
    settings: {
      configVersion: 1,
      revision: 0,
      model: { provider: "deepseek", model: "deepseek-v4-flash" },
      preset: "deterministic",
      permissions: { approvalPolicy: "ask" },
      session: {
        streamRetention: 100,
        streamProjection: "enabled",
        sessionCleanupDays: cleanupDays,
      },
      defaultMode: "free",
      modelRoutes: [],
    },
    providers: [],
  };
}

function session(
  partial: Partial<AgentSessionSummary> & { sessionId: string },
): AgentSessionSummary {
  return {
    title: "",
    status: "disposed",
    cwd: "/tmp",
    createdAt: new Date().toISOString(),
    mode: "free",
    ...partial,
  };
}

function mountSection(view: DshStewardSettingsView | null, sessions: AgentSessionSummary[]) {
  resetSessionsStoreStub(view, sessions);
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(SessionsSettingsSection, { target });
  flushSync();
  return {
    target,
    text: () => target.textContent ?? "",
    dayHeaders: () =>
      [...target.querySelectorAll("span")]
        .filter((el) => /^\d{4}-\d{2}-\d{2}$/.test(el.textContent?.trim() ?? ""))
        .map((el) => el.textContent!.trim()),
    deleteButtons: () =>
      [...target.querySelectorAll("button[aria-label^='Delete session']")] as HTMLButtonElement[],
    buttonByText: (text: string) =>
      [...target.querySelectorAll("button")].find((el) => el.textContent?.trim() === text)!,
    numberInput: () => target.querySelector<HTMLInputElement>("input[type='number']")!,
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("SessionsSettingsSection (R14-C)", () => {
  it("renders sessions grouped by date in descending order and loads the list once", () => {
    const ctx = mountSection(baseView(), [
      session({
        sessionId: "agent-noon",
        title: "Noon probe",
        createdAt: "2026-09-12T10:00:00",
        mode: "create",
      }),
      session({
        sessionId: "agent-morning",
        title: "Morning probe",
        createdAt: "2026-09-12T09:00:00",
      }),
      session({ sessionId: "agent-older", title: "Older probe", createdAt: "2026-09-10T15:00:00" }),
    ]);
    expect(ctx.dayHeaders()).toEqual(["2026-09-12", "2026-09-10"]);
    // 组内最新在前；标题与模式标签渲染。
    const text = ctx.text();
    expect(text.indexOf("Noon probe")).toBeGreaterThan(-1);
    expect(text.indexOf("Noon probe")).toBeLessThan(text.indexOf("Morning probe"));
    expect(text.indexOf("Morning probe")).toBeLessThan(text.indexOf("Older probe"));
    expect(text).toContain("Create");
    expect(text).toContain("General");
    expect(loadAgentSessions).toHaveBeenCalledTimes(1);
    // 策略输入从视图播种（默认 30）。
    expect(ctx.numberInput().value).toBe("30");
    ctx.cleanup();
  });

  it("disables delete for running sessions and enables it for idle ones", () => {
    const ctx = mountSection(baseView(), [
      session({ sessionId: "agent-idle", title: "Idle" }),
      session({ sessionId: "agent-running", title: "Running", status: "running" }),
    ]);
    const idleDelete = ctx
      .deleteButtons()
      .find((button) => button.getAttribute("aria-label") === "Delete session Idle")!;
    const runningDelete = ctx
      .deleteButtons()
      .find((button) => button.getAttribute("aria-label") === "Delete session Running")!;
    expect(idleDelete).toBeDefined();
    expect(runningDelete).toBeDefined();
    expect(idleDelete.disabled).toBe(false);
    expect(runningDelete.disabled).toBe(true);
    ctx.cleanup();
  });

  it("flows row deletion through the confirm dialog into cleanup({sessionIds})", async () => {
    const ctx = mountSection(baseView(), [session({ sessionId: "agent-victim", title: "Victim" })]);
    cleanupAgentSessions.mockResolvedValue({ kind: "summary", deleted: 1, kept: 0 });
    ctx.deleteButtons()[0]!.click();
    flushSync();
    // ConfirmDialog stub 打开（标题/描述携带会话名）；确认触发显式 ID 清理。
    expect(ctx.text()).toContain("Delete session");
    expect(ctx.text()).toContain("Victim");
    const confirm = ctx.target.querySelector<HTMLButtonElement>("[data-stub='confirm-accept']")!;
    expect(confirm).toBeDefined();
    confirm.click();
    flushSync();
    await vi.waitFor(() =>
      expect(cleanupAgentSessions).toHaveBeenCalledWith({ sessionIds: ["agent-victim"] }),
    );
    ctx.cleanup();
  });

  it("saves the retention policy through the settings update patch", async () => {
    const ctx = mountSection(baseView(30), [session({ sessionId: "agent-a" })]);
    updateAgentSettings.mockResolvedValue({ outcome: "updated", changed: true });
    const input = ctx.numberInput();
    input.value = "14";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    const save = ctx.buttonByText("Save");
    expect(save.disabled).toBe(false);
    save.click();
    flushSync();
    await vi.waitFor(() =>
      expect(updateAgentSettings).toHaveBeenCalledWith({
        session: { sessionCleanupDays: 14 },
      }),
    );
    ctx.cleanup();
  });

  it("shows the deleted/kept summary after Clean now", async () => {
    const ctx = mountSection(baseView(30), [session({ sessionId: "agent-a" })]);
    cleanupAgentSessions.mockResolvedValue({ kind: "summary", deleted: 3, kept: 5 });
    ctx.buttonByText("Clean now").click();
    flushSync();
    await vi.waitFor(() => expect(ctx.text()).toContain("Deleted 3 sessions"));
    expect(ctx.text()).toContain("kept 5");
    expect(cleanupAgentSessions).toHaveBeenCalledWith({ beforeDays: 30 });
    ctx.cleanup();
  });

  it("renders the empty state when no sessions exist", () => {
    const ctx = mountSection(baseView(), []);
    expect(ctx.text()).toContain("No sessions yet");
    expect(ctx.deleteButtons()).toHaveLength(0);
    ctx.cleanup();
  });
});

describe("kernel-only rows (R15 codex P1-3)", () => {
  it("marks kernel-only sessions and disables their delete button", () => {
    const ctx = mountSection(baseView(), [
      session({ sessionId: "agent-prod", title: "Prod session", hasTranscript: true }),
      session({ sessionId: "agent-kernel", title: "", hasTranscript: false }),
    ]);
    expect(ctx.text()).toContain("kernel-only");
    const buttons = ctx.deleteButtons();
    expect(buttons.length).toBe(2);
    const kernelBtn = buttons.find((b) => b.getAttribute("aria-label")?.includes("agent-kernel"))!;
    expect(kernelBtn.disabled).toBe(true);
    expect(kernelBtn.title).toContain("Kernel-only");
    const prodBtn = buttons.find((b) => b.getAttribute("aria-label")?.includes("Prod session"))!;
    expect(prodBtn.disabled).toBe(false);
    ctx.cleanup();
  });
});
