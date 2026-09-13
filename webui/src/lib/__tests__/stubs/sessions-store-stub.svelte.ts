/**
 * Sessions 设置分区的 store stub（R14-C 组件测试）：真 store 是 .svelte.ts runes
 * 模块；vi.mock 工厂里无法用裸 $state，故以本 runes stub 供 mock 工厂转发，
 * 组件对 agentRuntimeConfig/agentSessionsList 的 $derived 才能随测试改动重算。
 * 与 agent-store-stub 分开维护：本面只需要 sessions/cleanup 相关投影。
 */
import { vi } from "vitest";
import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";
import type { AgentSessionSummary } from "$shared/contracts/agent.js";

export const agentRuntimeConfig = $state({
  view: null as DshStewardSettingsView | null,
  loading: false,
  updating: false,
  error: null as string | null,
});

export const agentSessionsList = $state({
  loaded: false as boolean,
  loading: false,
  sessions: [] as AgentSessionSummary[],
  error: null as string | null,
});

export const loadAgentSessions = vi.fn();
export const loadAgentSettings = vi.fn();
export const updateAgentSettings = vi.fn();
export const cleanupAgentSessions = vi.fn();

export function resetSessionsStoreStub(
  view: DshStewardSettingsView | null,
  sessions: AgentSessionSummary[],
): void {
  agentRuntimeConfig.view = view;
  agentRuntimeConfig.loading = false;
  agentRuntimeConfig.updating = false;
  agentRuntimeConfig.error = null;
  agentSessionsList.loaded = sessions.length > 0;
  agentSessionsList.loading = false;
  agentSessionsList.sessions = sessions;
  agentSessionsList.error = null;
  loadAgentSessions.mockReset();
  loadAgentSettings.mockReset();
  updateAgentSettings.mockReset();
  cleanupAgentSessions.mockReset();
}
