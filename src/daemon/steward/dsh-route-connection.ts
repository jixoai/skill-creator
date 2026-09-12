/**
 * 模型路由连接测试探针（R7 model-route rich config，2026-09-12；codex R7 B4
 * 补齐 9 协议全覆盖）。
 *
 * 用户原始需求 [2026-09-12]：「设置面给路由一个连接测试按钮，未保存的草案也能
 * 探活；逐协议最小探测，10s 超时；失败 detail ≤200 字符且绝不包含 apiKey。
 * 这是用户显式配置的外呼，不是自动行为。」
 *
 * 正交意图：
 *   [1] 逐协议最小探测矩阵（discriminated by 判定语义）：
 *       - completion（2xx = ok）：anthropic-messages、openai-completions、
 *         openai-(codex-/azure-)responses、google-generative-ai（x-goog-api-key
 *         + v1beta generateContent）、mistral-conversations（Bearer
 *         /chat/completions）——各按 wire 语义发一条最小 completion。
 *       - reachability（诚实 failed，绝不伪装 ok）：google-vertex 需要 OAuth
 *         service account、bedrock-converse-stream 需要 SigV4 签名，路由草案的
 *         apiKey 无法完成完整探测；任何 HTTP 响应（含 401/403）只证明 endpoint
 *         可达，投影为 failed{detail 注明所需凭据类型 + HTTP status}；网络
 *         错误/超时投影为 failed{错误首行}。reachability 探针不消费 key，因此
 *         不设缺 key 前置门。
 *       - 未知协议：typed not implemented，不 fallback 到别的协议——wire 语义
 *         不同，猜出来的结果比没有更糟。
 *   [2] 失败即值：缺 key/网络错误/超时/非 2xx 全部投影为 failed{detail}，
 *       detail 取错误首行或状态码、剥除 key 材料、截断 ≤200ch——本模块永不 throw。
 * 妥协声明：仅 daemon 侧使用（Node 全局 fetch）；completion 判定只看状态码
 * （2xx = ok），不解析响应体语义——连接测试回答的是「端点+key+model 可用吗」，
 * 不是「回答正确吗」。
 */
import type {
  DshRouteConnectionTestInput,
  DshRouteConnectionTestResult,
} from "../../shared/contracts/dsh-runtime.js";

/** 连接测试依赖注入面（测试 mock fetch / 缩短超时）。 */
export interface DshRouteConnectionDeps {
  fetchImpl?: typeof fetch;
  /** 超时毫秒（默认 10s；测试注入小值）。 */
  timeoutMs?: number;
}

/** 缺 key 的固定失败文案（UI 依赖此语义提示先存 key）。 */
export const DSH_ROUTE_NO_KEY_DETAIL = "no API key configured for this route";

const DEFAULT_TIMEOUT_MS = 10_000;
const DETAIL_MAX_CHARS = 200;

/** 请求事实（url + headers + 序列化 body），两种判定语义共用。 */
interface ProbeRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * 协议 → 最小探测请求（discriminated union）：
 * - completion：2xx = ok（key 参与 Authorization，缺 key 前置拒绝）。
 * - reachability：任何 HTTP 响应都只算 endpoint 可达（诚实 failed），
 *   reachableDetail 注入 status；不消费 key、不设缺 key 前置门。
 */
type ProbeSpec =
  | ({ kind: "completion" } & ProbeRequest)
  | ({ kind: "reachability"; reachableDetail: (status: number) => string } & ProbeRequest);

/** baseURL 去尾部斜杠后直接拼接路径（本地网关 /anthropic 前缀原样保留）。 */
function joinRouteUrl(baseURL: string, suffix: string): string {
  return `${baseURL.replace(/\/+$/, "")}${suffix}`;
}

/**
 * 协议 → 最小探测请求。null = 该协议未实现探针（typed failed，不 fallback
 * 到别的协议——wire 语义不同，猜出来的结果比没有更糟）。
 */
function probeSpecFor(input: DshRouteConnectionTestInput, apiKey: string): ProbeSpec | null {
  switch (input.api) {
    case "anthropic-messages":
      return {
        kind: "completion",
        url: joinRouteUrl(input.baseURL, "/v1/messages"),
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: input.modelId,
          max_tokens: 4,
          messages: [{ role: "user", content: "ping" }],
        }),
      };
    case "openai-completions":
      return {
        kind: "completion",
        url: joinRouteUrl(input.baseURL, "/chat/completions"),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: input.modelId,
          max_completion_tokens: 4,
          messages: [{ role: "user", content: "ping" }],
        }),
      };
    case "openai-responses":
    case "openai-codex-responses":
    case "azure-openai-responses":
      return {
        kind: "completion",
        url: joinRouteUrl(input.baseURL, "/responses"),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: input.modelId, input: "ping" }),
      };
    case "google-generative-ai":
      // key 走 x-goog-api-key 头（等价于 ?key= query，且不把 key 写进 URL）。
      return {
        kind: "completion",
        url: joinRouteUrl(input.baseURL, `/v1beta/models/${input.modelId}:generateContent`),
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
      };
    case "google-vertex":
      // Vertex 用 OAuth service account 鉴权，API key 无法完成完整探测——
      // 只做可达性探针（任何 HTTP 响应 = endpoint 可达，诚实 failed）。
      return {
        kind: "reachability",
        url: joinRouteUrl(
          input.baseURL,
          `/v1/projects/-/locations/-/publishers/google/models/${input.modelId}:generateContent`,
        ),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
        reachableDetail: (status) =>
          `vertex requires OAuth credentials; endpoint reachable (HTTP ${status})`,
      };
    case "mistral-conversations":
      return {
        kind: "completion",
        url: joinRouteUrl(input.baseURL, "/chat/completions"),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: input.modelId,
          max_tokens: 4,
          messages: [{ role: "user", content: "ping" }],
        }),
      };
    case "bedrock-converse-stream":
      // Bedrock 用 SigV4 请求签名，静态 key 无法直接签——同 Vertex 的可达性语义。
      return {
        kind: "reachability",
        url: joinRouteUrl(input.baseURL, `/model/${input.modelId}/invoke-with-response-stream`),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
        reachableDetail: (status) => `bedrock requires SigV4; endpoint reachable (HTTP ${status})`,
      };
    default:
      return null;
  }
}

/**
 * 有限诊断文本：取首行、剥除 key 材料、截断 ≤200ch、空值兜底。
 * key 剥除是防御性的（错误串理论上不含 key，但网关回显 body 不可信）。
 */
function safeDetail(raw: string, apiKey: string): string {
  const firstLine = raw.split("\n")[0] ?? raw;
  const stripped = apiKey.length > 0 ? firstLine.split(apiKey).join("[redacted]") : firstLine;
  const clamped =
    stripped.length > DETAIL_MAX_CHARS ? stripped.slice(0, DETAIL_MAX_CHARS) : stripped;
  const trimmed = clamped.trim();
  return trimmed.length > 0 ? trimmed : "connection failed";
}

/**
 * 路由连接测试（用户显式触发的外呼）。输入是路由草案事实（api/baseURL/apiKey/
 * modelId），输出是 typed 结果——ok 计真实往返毫秒；failed 携带 ≤200ch 的
 * 有限诊断。绝不 throw：所有失败路径都收敛为值。
 */
export async function testDshRouteConnection(
  input: DshRouteConnectionTestInput,
  deps: DshRouteConnectionDeps = {},
): Promise<DshRouteConnectionTestResult> {
  // reachability 探针不消费 key（完整探测本来就需要 OAuth/SigV4），缺 key 不拦。
  const apiKey = input.apiKey ?? "";
  const spec = probeSpecFor(input, apiKey);
  if (spec === null) {
    return { outcome: "failed", detail: `protocol ${input.api} probe not implemented` };
  }
  if (spec.kind === "completion" && input.apiKey === undefined) {
    return { outcome: "failed", detail: DSH_ROUTE_NO_KEY_DETAIL };
  }
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch: typeof fetch = deps.fetchImpl ?? ((request, init) => fetch(request, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await doFetch(spec.url, {
      method: "POST",
      headers: spec.headers,
      body: spec.body,
      signal: controller.signal,
    });
    if (spec.kind === "reachability") {
      // 任何 HTTP 响应（含 2xx）都只证明 endpoint 可达：完整探测需要 OAuth/SigV4，
      // ok 的语义必须真实——这里绝不把可达性伪装成连接成功。
      return {
        outcome: "failed",
        detail: safeDetail(spec.reachableDetail(response.status), apiKey),
      };
    }
    if (response.ok) {
      return { outcome: "ok", latencyMs: Math.max(0, Date.now() - startedAt) };
    }
    let snippet = "";
    try {
      snippet = (await response.text()).split("\n")[0] ?? "";
    } catch {
      // body 读失败不影响判定：状态码已足够。
    }
    return {
      outcome: "failed",
      detail: safeDetail(
        snippet ? `HTTP ${response.status}: ${snippet}` : `HTTP ${response.status}`,
        apiKey,
      ),
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    if (aborted) return { outcome: "failed", detail: `timed out after ${timeoutMs}ms` };
    return {
      outcome: "failed",
      detail: safeDetail(error instanceof Error ? error.message : String(error), apiKey),
    };
  } finally {
    clearTimeout(timer);
  }
}
