/**
 * Steward DSH settings/credentials/session-stream 服务（openspec dsh-runtime-integration task 3.3）。
 *
 * 用户原始需求 [2026-09-06]（tasks 3.3）：「适配 model/preset/permission/session controls
 * 与 DSH client stream projection。runtime settings/config revision and session streams
 * are available to the later DSH client plugin; credentials are redacted from run/audit
 * payloads. No browser component is required in this phase.」
 * 事实源：docs/research/2026-09-06-dsh-integration.md——`agent-default-model` settings
 * namespace 持有 `{provider, model, reasoningEffort?}`；approval policy 只做 runtime
 * context 投影、不替代 Manager 授权；assistant stream 只是实时 presentation，durable
 * 回放归 session event log / Manager audit。
 *
 * 正交意图：
 *   [1] settings/credentials 持久化与 revision：atomicWriteUtf8、safeParse 不兼容→默认值、
 *       I/O 故障→typed UNAVAILABLE；凭据只落 0600 私有文件，任何视图不回显。
 *   [2] 无 fallback 的运行时 preset 解析：deterministic 走脚本 adapter；live 缺凭据
 *       返回类型化失败，绝不静默回退。
 *   [3] 脱敏 session stream 环形投影：给后续 DSH client plugin 的进程内实时帧；
 *       retention/projection 由 settings.session 控制。
 * 妥协声明：三意图同文件，因为 stream 投影的保留策略就是 settings.session 的执行面，
 * 物理拆分会造成双向依赖；帧缓冲只驻内存（durable 回放已由 session log + audit 承担）。
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { normalizeApiKey } from "@deepseek-ai/dsh-llm";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  DshStewardSettingsSchema,
  redactDshPayload,
  type DshCredentialClearInput,
  type DshCredentialSetInput,
  type DshCredentialSetResult,
  type DshRuntimePresetResolution,
  type DshSessionStreamFrame,
  type DshSessionStreamsInput,
  type DshSettingsUpdate,
  type DshSettingsUpdateResult,
  type DshStewardModelSelection,
  type DshStewardSettings,
  type DshStewardSettingsView,
} from "../../shared/contracts/dsh-runtime.js";
import type { SkillToolCall } from "../../shared/contracts/skill-steward.js";
import { DomainError } from "../domain-error.js";
import { dshRouteApiKeyEnv, type DshModelRoute } from "../../shared/contracts/dsh-runtime.js";
import { homeDir } from "../../shared/paths.js";
import { resolveDefaultDshHome } from "../dsh-host-lifecycle.js";
import { atomicWriteUtf8 } from "../path-safety.js";
import {
  STEWARD_DETERMINISTIC_MODEL,
  STEWARD_DETERMINISTIC_PROVIDER,
} from "./dsh-agent-runtime.js";

/** settings 默认值：deterministic preset + ask 审批 + enabled 投影（revision 0）。 */
export function defaultDshStewardSettings(): DshStewardSettings {
  return {
    configVersion: 1,
    revision: 0,
    model: { provider: STEWARD_DETERMINISTIC_PROVIDER, model: STEWARD_DETERMINISTIC_MODEL },
    preset: "deterministic",
    permissions: { approvalPolicy: "ask" },
    session: { streamRetention: 100, streamProjection: "enabled" },
    defaultMode: "free",
    modelRoutes: [],
  };
}

/**
 * 模型路由桥（官方热面，2026-09-11）：把持久路由写进 $DSH_HOME/settings.yaml
 * 的 llm-pi-ai: 段（settings-file 行热加载，路由即时注册/注销）。写失败按
 * typed UNAVAILABLE 上抛——桥断则路由不生效，不能静默。
 */
async function syncDshModelRoutes(routes: readonly DshModelRoute[]): Promise<void> {
  const dshHome = resolveDefaultDshHome();
  const file = path.join(dshHome, "settings.yaml");
  let doc: Record<string, unknown> = {};
  try {
    const raw = await fsp.readFile(file, "utf8");
    const parsed = parseYaml(raw);
    if (typeof parsed === "object" && parsed !== null) doc = parsed as Record<string, unknown>;
  } catch {
    // 无文件/坏 YAML：以空文档起步（首写会创建）。
  }
  const providers: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    providers[route.provider] = {
      apiKeyEnv: dshRouteApiKeyEnv(route.provider),
      ...(route.api ? { api: route.api } : {}),
      baseURL: route.baseURL,
      // icon 是本地 UI 字段，不进 DSH profile（未知键内核拒收）。
      models: route.models.map((model) => ({
        id: model.id,
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      })),
    };
  }
  doc["llm-pi-ai"] = { providers };
  await fsp.mkdir(dshHome, { recursive: true });
  try {
    atomicWriteUtf8(file, stringifyYaml(doc));
  } catch (error) {
    throw new DomainError(
      "UNAVAILABLE",
      `DSH model-route sync failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 凭据桥：路由 provider 的 key 写/清 $DSH_HOME/.credentials.yaml（credentials
 * 行热解析，即时生效）。非路由 provider 只落本地私有面（steward preset 用）。
 *
 * 内核 credentials-local（0.1.5-rc.2）读 version-1 布局：顶层仅 version/refs/
 * records，凭据必须嵌在 refs 下；顶层平铺键会让下一次 boot 直接失败
 * （2026-09-12 R2 实测：B 轮粘贴 key 后冷启动 kernel unavailable）。
 */
async function syncDshRouteCredential(provider: string, apiKey: string | null): Promise<void> {
  const ref = dshRouteApiKeyEnv(provider);
  const dshHome = resolveDefaultDshHome();
  const file = path.join(dshHome, ".credentials.yaml");
  let doc: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(await fsp.readFile(file, "utf8"));
    if (typeof parsed === "object" && parsed !== null) doc = parsed as Record<string, unknown>;
  } catch {
    // 无文件/坏 YAML：空文档起步。
  }
  const existingRefs = doc.refs;
  const refs: Record<string, unknown> =
    typeof existingRefs === "object" && existingRefs !== null && !Array.isArray(existingRefs)
      ? (existingRefs as Record<string, unknown>)
      : {};
  // 升级残留治理：历史版本把 key 平铺在顶层（内核严格校验打挂 boot），写入时顺带
  // 迁进 refs；SKILL_CREATOR_ROUTE_KEY_* 旧前缀已废弃，直接清除。
  for (const key of Object.keys(doc)) {
    if (key === "version" || key === "refs" || key === "records") continue;
    const value = doc[key];
    if (key.startsWith("SKILL_CREATOR_ROUTE_KEY_")) {
      delete doc[key];
      continue;
    }
    if (typeof value === "string" && value.length > 0 && /^[A-Z0-9_]+_API_KEY$/.test(key)) {
      if (!(key in refs)) refs[key] = value;
      delete doc[key];
    }
  }
  if (apiKey === null) delete refs[ref];
  else refs[ref] = apiKey;
  doc.version = 1;
  doc.refs = refs;
  try {
    await fsp.mkdir(dshHome, { recursive: true });
    atomicWriteUtf8(file, stringifyYaml(doc));
  } catch {
    // 凭据桥 best-effort：本地私有面仍是事实源，DSH 面下次写入时追平。
  }
}

interface PersistedCredentials {
  configVersion: number;
  credentials: Array<{ provider: string; apiKey: string }>;
}

function settingsFile(): string {
  return path.join(homeDir(), "steward-store", "dsh-settings.json");
}

function credentialsFile(): string {
  return path.join(homeDir(), "steward-store", "dsh-credentials.json");
}

/** 读私有 JSON 文件：ENOENT/坏 JSON/schema 不兼容 → null（调用方投影默认值）；I/O 故障 → typed。 */
async function readPrivateJson(file: string): Promise<unknown | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new DomainError(
      "UNAVAILABLE",
      `DSH settings read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null; // 不兼容 → 该领域空值（AGENTS 持久化载入法则）。
  }
}

/** 原子写私有文件（0600；凭据文件与 settings 文件同级私有）。 */
function writePrivateJson(file: string, value: unknown): void {
  try {
    atomicWriteUtf8(file, `${JSON.stringify(value, null, 2)}\n`);
  } catch (error) {
    throw new DomainError(
      "UNAVAILABLE",
      `DSH settings write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** DSH round → stream collector 的回调面（与 runDshStewardToolRound 的钩子对齐）。 */
export interface DshStreamCollector {
  onTurnStart(turnText: string): void;
  onStatus(status: string): void;
  onToolCall(call: SkillToolCall): void;
  onTurnEnd(record: { adapterCalls: number; cancelled: boolean; toolDenied: boolean }): void;
}

/** Steward DSH settings 服务。 */
export interface DshSettingsService {
  /** 客户端 settings 投影（含 provider 凭据状态；永不包含凭据值）。 */
  getView(): Promise<DshStewardSettingsView>;
  /** 应用补丁；no-op 接受但不动 revision；跨字段校验失败返回类型化 rejected。 */
  update(patch: DshSettingsUpdate): Promise<DshSettingsUpdateResult>;
  /** 写入 provider 凭据（DSH normalizeApiKey 校验；0600 私有文件；视图不回显）。 */
  setCredential(input: DshCredentialSetInput): Promise<DshCredentialSetResult>;
  /** 清除 provider 凭据（允许清掉 live preset 依赖项；resolve 会类型化失败，不 fallback）。 */
  clearCredential(input: DshCredentialClearInput): Promise<DshStewardSettingsView>;
  /** 无 fallback 的运行时 preset 解析（dsh-agent-runtime / pipeline 消费）。 */
  resolveRuntimePreset(): Promise<DshRuntimePresetResolution>;
  /** 追加一帧（projection disabled 时丢弃）；payload 在此强制脱敏。 */
  appendStreamFrame(frame: Omit<DshSessionStreamFrame, "seq">): Promise<void>;
  /** 读取投影帧（runId 可选过滤；最新 limit 帧按 seq 升序）。 */
  listStreamFrames(input: DshSessionStreamsInput): Promise<DshSessionStreamFrame[]>;
  /** 构造 DSH round 用的帧收集器（创建时固化 projection/retention 快照）。 */
  createStreamCollector(runId: string, sessionId: string): Promise<DshStreamCollector>;
}

/** 服务端内部状态（每次调用从盘读取 settings/credentials；帧缓冲归实例）。 */
interface ServiceInternals {
  settings: DshStewardSettings;
  credentials: Map<string, string>;
}

async function loadInternals(): Promise<ServiceInternals> {
  const [rawSettings, rawCredentials] = await Promise.all([
    readPrivateJson(settingsFile()),
    readPrivateJson(credentialsFile()),
  ]);
  const parsedSettings = DshStewardSettingsSchema.safeParse(rawSettings);
  const credentials = new Map<string, string>();
  if (
    typeof rawCredentials === "object" &&
    rawCredentials !== null &&
    Array.isArray((rawCredentials as PersistedCredentials).credentials)
  ) {
    for (const entry of (rawCredentials as PersistedCredentials).credentials) {
      if (
        typeof entry?.provider === "string" &&
        entry.provider.length > 0 &&
        typeof entry?.apiKey === "string" &&
        entry.apiKey.length > 0
      ) {
        credentials.set(entry.provider, entry.apiKey);
      }
    }
  }
  return {
    settings: parsedSettings.success ? parsedSettings.data : defaultDshStewardSettings(),
    credentials,
  };
}

function viewOf(
  settings: DshStewardSettings,
  credentials: Map<string, string>,
): DshStewardSettingsView {
  return {
    settings,
    providers: [...credentials.keys()].map((provider) => ({ provider, configured: true })),
  };
}

function persistCredentials(credentials: Map<string, string>): void {
  const value: PersistedCredentials = {
    configVersion: 1,
    credentials: [...credentials.entries()].map(([provider, apiKey]) => ({ provider, apiKey })),
  };
  writePrivateJson(credentialsFile(), value);
}

/** 模型选择相等比较（与 DSH callConfigEquals 的字段语义对齐）。 */
function modelEquals(a: DshStewardModelSelection, b: DshStewardModelSelection): boolean {
  return (
    a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort
  );
}

function settingsEqual(a: DshStewardSettings, b: DshStewardSettings): boolean {
  return (
    modelEquals(a.model, b.model) &&
    a.preset === b.preset &&
    a.permissions.approvalPolicy === b.permissions.approvalPolicy &&
    a.session.streamRetention === b.session.streamRetention &&
    a.session.streamProjection === b.session.streamProjection &&
    a.defaultMode === b.defaultMode &&
    JSON.stringify(a.modelRoutes) === JSON.stringify(b.modelRoutes)
  );
}

/** 创建 settings 服务（home 由 setHomeOverride 隔离测试）。 */
export function createDshSettingsService(): DshSettingsService {
  let frames: DshSessionStreamFrame[] = [];
  let seq = 0;

  const appendFrame = (frame: Omit<DshSessionStreamFrame, "seq">): void => {
    seq += 1;
    frames.push({ ...frame, seq, payload: redactDshPayload(frame.payload) });
  };

  const trimTo = (retention: number): void => {
    if (frames.length > retention) frames = frames.slice(frames.length - retention);
  };

  return {
    async getView() {
      const { settings, credentials } = await loadInternals();
      return viewOf(settings, credentials);
    },

    async update(patch) {
      const { settings, credentials } = await loadInternals();
      const next: DshStewardSettings = {
        ...settings,
        ...(patch.model ? { model: patch.model } : {}),
        ...(patch.preset ? { preset: patch.preset } : {}),
        ...(patch.defaultMode ? { defaultMode: patch.defaultMode } : {}),
        ...(patch.modelRoutes ? { modelRoutes: patch.modelRoutes } : {}),
        permissions: { ...settings.permissions, ...(patch.permissions ?? {}) },
        session: { ...settings.session, ...(patch.session ?? {}) },
      };
      // 跨字段校验只针对补丁触碰的字段：允许先切 preset 或先清凭据再分步修复。
      if (patch.preset === "live" && !credentials.has(next.model.provider)) {
        return {
          outcome: "rejected",
          code: "PRESET_REQUIRES_CREDENTIAL",
          detail: `preset "live" requires a stored credential for provider "${next.model.provider}"`,
        };
      }
      if (patch.model && next.preset === "live" && !credentials.has(next.model.provider)) {
        return {
          outcome: "rejected",
          code: "MODEL_PROVIDER_WITHOUT_CREDENTIAL",
          detail: `live preset has no credential for provider "${next.model.provider}"`,
        };
      }
      const changed = !settingsEqual(next, settings);
      if (changed) {
        next.revision = settings.revision + 1;
        writePrivateJson(settingsFile(), next);
        // 路由变更即桥接 DSH 热面（官方 settings-file 行热加载）。
        await syncDshModelRoutes(next.modelRoutes);
      }
      return {
        outcome: "updated",
        view: viewOf(next, credentials),
        changed,
        previousRevision: settings.revision,
        revision: next.revision,
      };
    },

    async setCredential(input) {
      const check = normalizeApiKey(input.apiKey);
      if (!check.ok) {
        return {
          outcome: "rejected",
          code: "INVALID_API_KEY",
          detail: `provider "${input.provider}" key rejected: ${check.reason}`,
        };
      }
      const { settings, credentials } = await loadInternals();
      if (credentials.get(input.provider) !== check.value) {
        credentials.set(input.provider, check.value);
        const next = { ...settings, revision: settings.revision + 1 };
        persistCredentials(credentials);
        writePrivateJson(settingsFile(), next);
        await syncDshRouteCredential(input.provider, check.value);
        return { outcome: "stored", view: viewOf(next, credentials) };
      }
      return { outcome: "stored", view: viewOf(settings, credentials) };
    },

    async clearCredential(input) {
      const { settings, credentials } = await loadInternals();
      if (credentials.has(input.provider)) {
        credentials.delete(input.provider);
        const next = { ...settings, revision: settings.revision + 1 };
        persistCredentials(credentials);
        writePrivateJson(settingsFile(), next);
        await syncDshRouteCredential(input.provider, null);
        return viewOf(next, credentials);
      }
      return viewOf(settings, credentials);
    },

    async resolveRuntimePreset() {
      const { settings, credentials } = await loadInternals();
      if (settings.preset === "deterministic") {
        return {
          outcome: "deterministic",
          model: {
            provider: STEWARD_DETERMINISTIC_PROVIDER,
            model: STEWARD_DETERMINISTIC_MODEL,
          },
        };
      }
      const apiKey = credentials.get(settings.model.provider);
      if (apiKey === undefined) {
        return {
          outcome: "failed",
          code: "CREDENTIAL_MISSING",
          detail: `live preset has no credential for provider "${settings.model.provider}" (no fallback)`,
        };
      }
      return { outcome: "live", model: settings.model, apiKey };
    },

    async appendStreamFrame(frame) {
      const { settings } = await loadInternals();
      if (settings.session.streamProjection === "disabled") return;
      appendFrame(frame);
      trimTo(settings.session.streamRetention);
    },

    async listStreamFrames(input) {
      const limit = input.limit ?? 50;
      const filtered = input.runId ? frames.filter((frame) => frame.runId === input.runId) : frames;
      return filtered.slice(Math.max(0, filtered.length - limit));
    },

    async createStreamCollector(runId, sessionId) {
      const { settings } = await loadInternals();
      const enabled = settings.session.streamProjection === "enabled";
      const retention = settings.session.streamRetention;
      const collector: DshStreamCollector = {
        onTurnStart(turnText) {
          if (!enabled) return;
          appendFrame({
            at: new Date().toISOString(),
            runId,
            sessionId,
            kind: "turn-start",
            text: turnText,
          });
          trimTo(retention);
        },
        onStatus(status) {
          if (!enabled) return;
          appendFrame({
            at: new Date().toISOString(),
            runId,
            sessionId,
            kind: "status",
            text: status,
          });
          trimTo(retention);
        },
        onToolCall(call) {
          if (!enabled) return;
          appendFrame({
            at: new Date().toISOString(),
            runId,
            sessionId,
            kind: "tool-call",
            toolName: call.tool,
            payload: { input: call.input },
          });
          appendFrame({
            at: new Date().toISOString(),
            runId,
            sessionId,
            kind: "tool-result",
            toolName: call.tool,
            payload: { result: call.result },
          });
          trimTo(retention);
        },
        onTurnEnd(record) {
          if (!enabled) return;
          appendFrame({
            at: new Date().toISOString(),
            runId,
            sessionId,
            kind: "turn-end",
            payload: { ...record },
          });
          trimTo(retention);
        },
      };
      return collector;
    },
  };
}
