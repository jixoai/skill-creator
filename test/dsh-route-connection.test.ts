/**
 * 模型路由连接测试（R7 2026-09-12）单测 + 本地网关真实集成。
 *
 * 用户原始需求 [2026-09-12]：「设置面给路由一个连接测试按钮，未保存的草案也能
 * 探活；逐协议最小探测，10s 超时；失败 detail ≤200 字符且绝不包含 apiKey。」
 *
 * 正交意图：
 *   [1] 协议矩阵（codex R7 B4：9 协议全覆盖）：anthropic-messages /
 *       openai-completions / responses 三族 / google-generative-ai /
 *       mistral-conversations 的 URL、headers、body 语义；google-vertex 与
 *       bedrock-converse-stream 的诚实可达性语义（任何 HTTP 响应 → failed
 *       {所需凭据类型 + status}，绝不伪装 ok）；未知协议的类型化拒绝。
 *   [2] 失败即值：401/超时/网络错/缺 key 全部 failed{detail}；detail 不含 key、
 *       ≤200ch；ok 计真实往返毫秒。
 *   [3] RPC 面可达：agent.settings.testConnection 经真实 router 暴露。
 * 妥协声明：真实网关集成走 describe.skipIf 探活（CI 无网关自动跳过），与
 * test/agent-sessions-gateway-integration.test.ts 的探活模式一致。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDaemonDomain } from "../src/daemon/domain.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { DSH_ROUTE_API_PROTOCOLS } from "../src/shared/contracts/dsh-runtime.js";
import {
  DSH_ROUTE_NO_KEY_DETAIL,
  testDshRouteConnection,
} from "../src/daemon/steward/dsh-route-connection.js";
import { createDshSettingsService } from "../src/daemon/steward/dsh-settings.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";

const API_KEY = "sk-conn-test-1";
const ANTHROPIC_INPUT = {
  api: "anthropic-messages",
  baseURL: "http://localhost:20002/anthropic",
  apiKey: API_KEY,
  modelId: "glm-5.3-flash",
} as const;

type FetchCall = { url: string | URL | Request; init?: RequestInit };

/** 记录调用并返回固定 Response 的 fetch mock。 */
function recordingFetch(
  status: number,
  body = "",
): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(body || null, { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** 永不 resolve、但尊重 abort signal 的挂死 fetch（超时路径）。 */
function hangingFetch(): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  }) as typeof fetch;
}

describe("testDshRouteConnection protocol matrix", () => {
  it("probes anthropic-messages with x-api-key + anthropic-version and minimal body", async () => {
    const { fetchImpl, calls } = recordingFetch(200);
    const result = await testDshRouteConnection(ANTHROPIC_INPUT, { fetchImpl });
    expect(result).toMatchObject({ outcome: "ok" });
    if (result.outcome === "ok") expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(calls.length).toBe(1);
    const call = calls[0]!;
    expect(String(call.url)).toBe("http://localhost:20002/anthropic/v1/messages");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(API_KEY);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(String(call.init?.body))).toEqual({
      model: "glm-5.3-flash",
      max_tokens: 4,
      messages: [{ role: "user", content: "ping" }],
    });
  });

  it("probes openai-completions via Bearer /chat/completions with max_completion_tokens", async () => {
    const { fetchImpl, calls } = recordingFetch(200);
    const result = await testDshRouteConnection(
      {
        api: "openai-completions",
        // 尾部斜杠归一化后直接拼接。
        baseURL: "https://api.openai.com/v1/",
        apiKey: API_KEY,
        modelId: "gpt-5.2",
      },
      { fetchImpl },
    );
    expect(result).toMatchObject({ outcome: "ok" });
    const call = calls[0]!;
    expect(String(call.url)).toBe("https://api.openai.com/v1/chat/completions");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(String(call.init?.body))).toEqual({
      model: "gpt-5.2",
      max_completion_tokens: 4,
      messages: [{ role: "user", content: "ping" }],
    });
  });

  it("probes the responses family (openai/codex/azure) via Bearer /responses with input ping", async () => {
    for (const api of ["openai-responses", "openai-codex-responses", "azure-openai-responses"]) {
      const { fetchImpl, calls } = recordingFetch(200);
      const result = await testDshRouteConnection(
        { api, baseURL: "https://example.test", apiKey: API_KEY, modelId: "m-1" },
        { fetchImpl },
      );
      expect(result.outcome, api).toBe("ok");
      const call = calls[0]!;
      expect(String(call.url)).toBe("https://example.test/responses");
      const headers = call.init?.headers as Record<string, string>;
      expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
      expect(JSON.parse(String(call.init?.body))).toEqual({ model: "m-1", input: "ping" });
    }
  });

  it("probes google-generative-ai via x-goog-api-key header on v1beta generateContent", async () => {
    const { fetchImpl, calls } = recordingFetch(200);
    const result = await testDshRouteConnection(
      {
        api: "google-generative-ai",
        // 尾部斜杠归一化后直接拼接。
        baseURL: "https://generativelanguage.googleapis.com/",
        apiKey: API_KEY,
        modelId: "gemini-3-pro",
      },
      { fetchImpl },
    );
    expect(result).toMatchObject({ outcome: "ok" });
    expect(calls.length).toBe(1);
    const call = calls[0]!;
    expect(String(call.url)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent",
    );
    const headers = call.init?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe(API_KEY);
    expect(JSON.parse(String(call.init?.body))).toEqual({
      contents: [{ parts: [{ text: "ping" }] }],
    });
  });

  it("projects google-generative-ai auth failures without leaking the key", async () => {
    const { fetchImpl } = recordingFetch(401, '{"error":{"message":"API key not valid"}}');
    const result = await testDshRouteConnection(
      {
        api: "google-generative-ai",
        baseURL: "https://example.test",
        apiKey: API_KEY,
        modelId: "m",
      },
      { fetchImpl },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.detail).toContain("HTTP 401");
      expect(result.detail).not.toContain(API_KEY);
    }
  });

  it("probes mistral-conversations via Bearer /chat/completions with max_tokens", async () => {
    const { fetchImpl, calls } = recordingFetch(200);
    const result = await testDshRouteConnection(
      {
        api: "mistral-conversations",
        baseURL: "https://api.mistral.ai/v1",
        apiKey: API_KEY,
        modelId: "mistral-large-latest",
      },
      { fetchImpl },
    );
    expect(result).toMatchObject({ outcome: "ok" });
    const call = calls[0]!;
    expect(String(call.url)).toBe("https://api.mistral.ai/v1/chat/completions");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(String(call.init?.body))).toEqual({
      model: "mistral-large-latest",
      max_tokens: 4,
      messages: [{ role: "user", content: "ping" }],
    });
  });

  it("projects google-vertex as honest reachability: any HTTP response is failed, never ok", async () => {
    // 无 key 也可探（Vertex 完整探测需要 OAuth service account，与 key 无关）。
    const { fetchImpl, calls } = recordingFetch(403);
    const result = await testDshRouteConnection(
      {
        api: "google-vertex",
        baseURL: "https://aiplatform.googleapis.com",
        modelId: "gemini-3-pro",
      },
      { fetchImpl },
    );
    expect(result).toEqual({
      outcome: "failed",
      detail: "vertex requires OAuth credentials; endpoint reachable (HTTP 403)",
    });
    expect(calls.length).toBe(1);
    expect(String(calls[0]!.url)).toBe(
      "https://aiplatform.googleapis.com/v1/projects/-/locations/-/publishers/google/models/gemini-3-pro:generateContent",
    );
    // 即使 2xx 也不伪装 ok（可达 ≠ 凭据可用）。
    const okStub = recordingFetch(200);
    const okResult = await testDshRouteConnection(
      {
        api: "google-vertex",
        baseURL: "https://aiplatform.googleapis.com",
        apiKey: API_KEY,
        modelId: "gemini-3-pro",
      },
      { fetchImpl: okStub.fetchImpl },
    );
    expect(okResult).toEqual({
      outcome: "failed",
      detail: "vertex requires OAuth credentials; endpoint reachable (HTTP 200)",
    });
  });

  it("projects bedrock-converse-stream as honest reachability with the SigV4 detail", async () => {
    const { fetchImpl, calls } = recordingFetch(401);
    const result = await testDshRouteConnection(
      {
        api: "bedrock-converse-stream",
        baseURL: "https://bedrock-runtime.us-east-1.amazonaws.com",
        modelId: "amazon.nova-2-lite-v1:0",
      },
      { fetchImpl },
    );
    expect(result).toEqual({
      outcome: "failed",
      detail: "bedrock requires SigV4; endpoint reachable (HTTP 401)",
    });
    expect(calls.length).toBe(1);
    expect(String(calls[0]!.url)).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-2-lite-v1:0/invoke-with-response-stream",
    );
    expect(result.detail).not.toContain(API_KEY);
  });

  it("projects reachability network errors from the error first line", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed\nsecond line never shown");
    }) as typeof fetch;
    for (const api of ["google-vertex", "bedrock-converse-stream"] as const) {
      const result = await testDshRouteConnection(
        { api, baseURL: "https://example.test", modelId: "m" },
        { fetchImpl },
      );
      expect(result, api).toEqual({ outcome: "failed", detail: "fetch failed" });
    }
  });

  it("still gates the new completion protocols (google/mistral) on the no-key precondition", async () => {
    for (const api of ["google-generative-ai", "mistral-conversations"] as const) {
      const { fetchImpl, calls } = recordingFetch(200);
      const result = await testDshRouteConnection(
        { api, baseURL: "https://example.test", modelId: "m" },
        { fetchImpl },
      );
      expect(result, api).toEqual({ outcome: "failed", detail: DSH_ROUTE_NO_KEY_DETAIL });
      expect(calls.length, api).toBe(0);
    }
  });

  it("implements a probe for every published protocol (no silent not-implemented)", async () => {
    for (const api of DSH_ROUTE_API_PROTOCOLS) {
      const { fetchImpl } = recordingFetch(200);
      const result = await testDshRouteConnection(
        { api, baseURL: "https://example.test", apiKey: API_KEY, modelId: "m" },
        { fetchImpl },
      );
      expect(JSON.stringify(result), api).not.toContain("not implemented");
    }
  });

  it("returns typed not-implemented for unknown protocols without any fetch", async () => {
    const { fetchImpl, calls } = recordingFetch(200);
    const result = await testDshRouteConnection(
      { api: "totally-unknown", baseURL: "https://example.test", apiKey: API_KEY, modelId: "m" },
      { fetchImpl },
    );
    expect(result).toEqual({
      outcome: "failed",
      detail: "protocol totally-unknown probe not implemented",
    });
    expect(calls.length).toBe(0);
  });

  it("fails with the fixed no-key detail before any fetch when apiKey is absent", async () => {
    const { fetchImpl, calls } = recordingFetch(200);
    const result = await testDshRouteConnection(
      { api: "anthropic-messages", baseURL: "https://example.test", modelId: "m" },
      { fetchImpl },
    );
    expect(result).toEqual({ outcome: "failed", detail: DSH_ROUTE_NO_KEY_DETAIL });
    expect(result.detail).toBe("no API key configured for this route");
    expect(calls.length).toBe(0);
  });
});

describe("testDshRouteConnection failure projection", () => {
  it("projects HTTP 401 as failed with status in detail and never the key", async () => {
    const { fetchImpl } = recordingFetch(401, '{"error":"invalid api key"}');
    const result = await testDshRouteConnection(ANTHROPIC_INPUT, { fetchImpl });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.detail).toContain("HTTP 401");
      expect(result.detail).not.toContain(API_KEY);
      expect(result.detail.length).toBeLessThanOrEqual(200);
    }
  });

  it("strips the apiKey even if the server body echoes it back", async () => {
    const { fetchImpl } = recordingFetch(403, `{"error":"key ${API_KEY} rejected"}`);
    const result = await testDshRouteConnection(ANTHROPIC_INPUT, { fetchImpl });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.detail).not.toContain(API_KEY);
      expect(result.detail).toContain("[redacted]");
    }
  });

  it("clamps detail to 200 chars for huge error bodies", async () => {
    const { fetchImpl } = recordingFetch(500, "x".repeat(5000));
    const result = await testDshRouteConnection(ANTHROPIC_INPUT, { fetchImpl });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.detail).toContain("HTTP 500");
      expect(result.detail.length).toBeLessThanOrEqual(200);
    }
  });

  it("times out after the configured deadline (AbortController) and reports it", async () => {
    const result = await testDshRouteConnection(ANTHROPIC_INPUT, {
      fetchImpl: hangingFetch(),
      timeoutMs: 25,
    });
    expect(result).toEqual({ outcome: "failed", detail: "timed out after 25ms" });
  });

  it("projects network errors from the error first line", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed\nsecond line never shown");
    }) as typeof fetch;
    const result = await testDshRouteConnection(ANTHROPIC_INPUT, { fetchImpl });
    expect(result).toEqual({ outcome: "failed", detail: "fetch failed" });
  });

  it("falls back to a non-empty detail for empty error messages", async () => {
    const fetchImpl = (async () => {
      throw new Error("");
    }) as typeof fetch;
    const result = await testDshRouteConnection(ANTHROPIC_INPUT, { fetchImpl });
    expect(result).toEqual({ outcome: "failed", detail: "connection failed" });
  });
});

describe("DshSettingsService.testConnection", () => {
  it("delegates to the probe with injected fetch and timeout (service facade)", async () => {
    const service = createDshSettingsService({
      routeConnectionFetch: recordingFetch(200).fetchImpl,
    });
    const result = await service.testConnection(ANTHROPIC_INPUT);
    expect(result).toMatchObject({ outcome: "ok" });
  });

  it("uses the call-time global fetch so stubbing works without injection", async () => {
    const mock = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", mock);
    try {
      const service = createDshSettingsService();
      const result = await service.testConnection(ANTHROPIC_INPUT);
      expect(result).toMatchObject({ outcome: "ok" });
      expect(mock.mock.calls.length).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("injects the stored credential when apiKey is absent and provider is given", async () => {
    const seen: Array<{ headers: HeadersInit }> = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seen.push({ headers: init?.headers ?? {} });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    // 先经服务面存一条凭据（私有 store），再以 provider 引用做测试。
    const service = createDshSettingsService({ routeConnectionFetch: fetchImpl });
    await service.setCredential({ provider: "gateway-x", apiKey: "sk-stored-1" });
    const result = await service.testConnection({
      api: "anthropic-messages",
      baseURL: "https://gateway-x.example",
      provider: "gateway-x",
      modelId: "m-1",
    });
    expect(result).toMatchObject({ outcome: "ok" });
    const headers = seen[0]?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-stored-1");
  });

  it("keeps the typed no-key failure when the stored credential is absent", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const service = createDshSettingsService({ routeConnectionFetch: fetchImpl });
    const result = await service.testConnection({
      api: "anthropic-messages",
      baseURL: "https://gateway-x.example",
      provider: "gateway-unknown",
      modelId: "m-1",
    });
    expect(result).toEqual({ outcome: "failed", detail: DSH_ROUTE_NO_KEY_DETAIL });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

const previousHome = process.env.SKILL_CREATOR_HOME;
const previousDshHome = process.env.DSH_HOME;
let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-dsh-conn-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  process.env.DSH_HOME = path.join(sandbox, "dsh");
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("agent.settings.testConnection RPC surface", () => {
  it("exposes the probe through the public router with typed results", async () => {
    const ok = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", ok);
    const client = createRouterClient(
      createRpcRouter({
        status: () => ({
          active: true,
          pid: process.pid,
          version: "test",
          port: 0,
          startedAt: 0,
          tray: "headless",
        }),
        domain: createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() }),
      }),
    );
    try {
      const okResult = await client.agent.settings.testConnection({ ...ANTHROPIC_INPUT });
      expect(okResult).toMatchObject({ outcome: "ok" });
      expect(typeof (okResult as { latencyMs?: number }).latencyMs).toBe("number");
      // 输入面无 apiKey → 固定 failed 文案（不触发外呼）。
      const noKey = await client.agent.settings.testConnection({
        api: "anthropic-messages",
        baseURL: "https://example.test",
        modelId: "m",
      });
      expect(noKey).toEqual({
        outcome: "failed",
        detail: "no API key configured for this route",
      });
      // reachability 协议经 RPC 面返回诚实 failed（stub 200 也只算可达）。
      const vertex = await client.agent.settings.testConnection({
        api: "google-vertex",
        baseURL: "https://aiplatform.googleapis.com",
        modelId: "gemini-3-pro",
      });
      expect(vertex).toEqual({
        outcome: "failed",
        detail: "vertex requires OAuth credentials; endpoint reachable (HTTP 200)",
      });
      // 未知协议同样经 RPC 面返回 typed not implemented。
      const notImplemented = await client.agent.settings.testConnection({
        api: "totally-unknown",
        baseURL: "https://example.test",
        apiKey: API_KEY,
        modelId: "m",
      });
      expect(notImplemented).toEqual({
        outcome: "failed",
        detail: "protocol totally-unknown probe not implemented",
      });
      // ok 探测 + vertex 可达性各真正外呼一次（noKey/unknown 在 fetch 前短路）。
      expect(ok.mock.calls.length).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/*
 * 真实本地网关集成（可选）：探活失败自动 skip（CI/离线环境）。
 * 网关事实（2026-09-12 用户供给）：BASE_URL http://localhost:20002/anthropic，
 * MODEL_ID glm-5.3-flash，API_KEY 任意值。
 */
const GATEWAY_BASE = "http://localhost:20002/anthropic";
const GATEWAY_MODEL = "glm-5.3-flash";

async function gatewayUp(): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "probe" },
      body: JSON.stringify({
        model: GATEWAY_MODEL,
        max_tokens: 4,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

const gatewayReachable = await gatewayUp();

describe.skipIf(!gatewayReachable)("route connection probe against the local gateway", () => {
  it("returns ok with a real round-trip latency for anthropic-messages", async () => {
    const result = await testDshRouteConnection({
      api: "anthropic-messages",
      baseURL: GATEWAY_BASE,
      apiKey: "gateway-probe-any-key",
      modelId: GATEWAY_MODEL,
    });
    expect(result).toMatchObject({ outcome: "ok" });
    if (result.outcome === "ok") expect(result.latencyMs).toBeGreaterThan(0);
  });
});
