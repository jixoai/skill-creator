/**
 * 响应式 agent store stub（Track B2 组件测试）：真 store 是 .svelte.ts runes
 * 模块；vi.mock 工厂里无法用裸 $state，故以本 runes stub 供 mock 工厂转发，
 * 组件对 agentRuntimeConfig/agentSession 的 $derived 才能随测试改动重算。
 */
import { vi } from "vitest";
import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";

export const agentRuntimeConfig = $state({
  view: null as DshStewardSettingsView | null,
  loading: false,
  updating: false,
  error: null as string | null,
});

export const agentSession = $state({
  sessionId: null as string | null,
  mode: null as string | null,
  /** 待建会话模式（R12-B 6：New Session 态模式卡/chip 的共享数据源）。 */
  pendingMode: "free" as string,
  status: "idle" as "idle" | "running",
  sending: false,
  items: [] as unknown[],
  todos: [] as unknown[],
  turnStartedAt: null as string | null,
  error: null as string | null,
});

export const updateAgentSettings = vi.fn();
export const createAgentSession = vi.fn();
export const sendAgentPrompt = vi.fn();
export const setAgentSessionMode = vi.fn();
export const cancelAgentSession = vi.fn();
export const beginNewAgentSession = vi.fn();

export function resetAgentStoreStub(view: DshStewardSettingsView | null): void {
  agentRuntimeConfig.view = view;
  agentRuntimeConfig.loading = false;
  agentRuntimeConfig.updating = false;
  agentRuntimeConfig.error = null;
  agentSession.sessionId = null;
  agentSession.mode = null;
  agentSession.pendingMode = "free";
  agentSession.status = "idle";
  agentSession.sending = false;
  agentSession.items = [];
  agentSession.todos = [];
  agentSession.turnStartedAt = null;
  agentSession.error = null;
  updateAgentSettings.mockReset();
  createAgentSession.mockReset();
  sendAgentPrompt.mockReset();
  setAgentSessionMode.mockReset();
  cancelAgentSession.mockReset();
  beginNewAgentSession.mockReset();
}
