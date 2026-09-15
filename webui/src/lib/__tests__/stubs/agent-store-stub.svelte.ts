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

/** 会话列表投影（R17-B：ComposerCard 的后端选择器起始目录来自当前会话 cwd）。 */
export const agentSessionsList = $state({
  loaded: false as boolean,
  loading: false,
  sessions: [] as Array<{ sessionId: string; cwd: string; mode: string }>,
});

/** C2：内核队列投影（QueueDock 消费）。 */
export const agentQueue = $state({
  items: [] as Array<{ messageId: string; target: string; text: string; attachments: number }>,
});

export const updateAgentSettings = vi.fn();
export const createAgentSession = vi.fn();
export const sendAgentPrompt = vi.fn();
export const setAgentSessionMode = vi.fn();
export const cancelAgentSession = vi.fn();
export const beginNewAgentSession = vi.fn();
// C1：ReferenceMenu 的会话列表惰性刷新面。
export const loadAgentSessions = vi.fn();
// C2：队列行级操作（QueueDock 消费；默认解析成功）。
export const updateAgentQueueItem = vi.fn().mockResolvedValue({ updated: true });
export const refreshAgentQueue = vi.fn();

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
  agentSessionsList.loaded = false;
  agentSessionsList.loading = false;
  agentSessionsList.sessions = [];
  updateAgentSettings.mockReset();
  createAgentSession.mockReset();
  sendAgentPrompt.mockReset();
  setAgentSessionMode.mockReset();
  cancelAgentSession.mockReset();
  beginNewAgentSession.mockReset();
}
