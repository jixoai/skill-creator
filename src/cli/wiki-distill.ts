/**
 * 用户原始需求 [2026-09-25]（openspec change skill-wiki-maintainer design §4 / tasks 1.5）：
 * 「CLI `wiki distill --workspace <ref> [--limit N(默认20,≤100)] [--json]`：
 * --json 输出 = start+status 轮询至终态后的完整 DistillStatusOutput（E 冻结
 * 共享 schema；r19 澄清——「ItemResult 全表」语义由 per-proposal ledger
 * statuses（proposalRefs 精简投影）承载，detail/appliedHash 是 ledger 行
 * 内部字段，不进 CLI 顶层输出）」。
 *
 * 正交意图：
 *   [1] wiki distill 命令单元（skill-wiki cli-kit 的 extraCommands 形状）：
 *       --workspace ref → WorkspaceId（宿主注入 registry 只读解析）；--limit
 *       1..patternsPerRun typed 校验（缺省 corpusPatternDefault，超限/非正整数
 *       → WikiUsageError exit 2）；--json = stdout 仅含 DistillStatusOutput 的
 *       合法 JSON（与 RPC/GUI 同一 schema，三面同源）。
 *   [2] daemon RPC 通路（distill 是 daemon 编排——绝不本地起服务）：IPC status
 *       （webUrl fragment 捕获 web token）→ /ws/rpc 上的 oRPC client
 *       （ContractRouterClient<RpcContract>，与 WebUI 同一契约推导，不手写
 *       传输载荷镜像）；typed DomainError（DISTILL_* 闭集）投影
 *       `<code>: <message>` exit 1。
 *   [3] 轮询与人读投影：start（daemon 侧阻塞至 admission）→ status 轮询至
 *       RunState 终态（completed/failed/cancelled）；awaiting-approval 期间提示
 *       去 proposal 面审批（CLI 无决定面——审批红线在 human-ui）。人读模式 =
 *       进度行（stderr）+ 终态摘要 + 逐项结果表（stdout，不吐原始 JSON）。
 * 妥协声明：web token 经 IPC status 的 webUrl fragment 获得（CLI 与 daemon 共享
 *   同一 SKILL_CREATOR_HOME 命名空间；本地 loopback 单用户委托）——不引入第二条
 *   鉴权通道；WebSocket 生命周期与命令执行同界（run 内 open/close，无常驻进程）。
 */
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";
import { WebSocket } from "ws";
import { DISTILL_BUDGETS, WikiUsageError, type CliIo, type WikiCliCommand } from "skill-wiki";
import type { DaemonStatus } from "../shared/contracts/daemon.js";
import type { DistillStatusOutput, RunState } from "../shared/contracts/wiki-distill.js";
import type { RpcContract } from "../shared/rpc-contract.js";

/** 强类型 RPC client（签名由共享契约推导；与 WebUI rpc-client 同一推导口径）。 */
type RpcClient = ContractRouterClient<RpcContract>;

/** RunState 终态谓词（E：completed/failed/cancelled；终态幂等可轮询）。 */
function isTerminalRunState(state: RunState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

/**
 * status 轮询间隔。start RPC 已阻塞到 admission，轮询只覆盖「人工在 proposal 面
 * 审批 → run 收敛」与 cancel 竞争窗口：本地 loopback status RPC 开销可忽略，
 * 500ms 固定间隔让 CLI 前台命令在决定落定后约半秒内退出（GUI 面板用 1.5s 是
 * 后台常驻节奏，前台命令取更快档；不做指数退避——无服务端压力面）。
 */
const STATUS_POLL_INTERVAL_MS = 500;
/** WS 建连等待上限（daemon 在本机 loopback；超时视为 daemon 失联）。 */
const CONNECT_TIMEOUT_MS = 5_000;

/** 宿主插槽（cli.ts 注入：状态探针 / registry 解析 / 版本握手）。 */
export interface WikiDistillCommandDeps {
  /** daemon 状态探针（IPC status；失败信息已含 "Run 'skill-creator start' first."）。 */
  requestStatus: () => Promise<DaemonStatus>;
  /** --workspace ref → WorkspaceId（宿主 registry 只读解析；失败抛 WikiUsageError）。 */
  resolveSource: (requested: string | undefined) => Promise<string>;
  /** CLI 包版本（daemon 版本不一致时给出替换指引）。 */
  cliVersion: string;
}

/** 组装 wiki distill 命令单元（挂入 createWikiCli 的 extraCommands）。 */
export function createWikiDistillCommand(deps: WikiDistillCommandDeps): WikiCliCommand {
  return {
    usage: "[--workspace <ref>] [--limit N] [--json]   (daemon RPC; limit 1-100, default 20)",
    minPositionals: 0,
    maxPositionals: 0,
    run: (context) =>
      runDistill({
        io: context.io,
        workspaceOption: stringOption(context.options.get("workspace")),
        limitOption: stringOption(context.options.get("limit")),
        json: context.options.has("json"),
        deps,
      }),
  };
}

function stringOption(value: string | true | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** --limit typed 校验：正整数 1..patternsPerRun（缺省 corpusPatternDefault）。 */
function parseDistillLimit(raw: string | undefined): number {
  if (raw === undefined) return DISTILL_BUDGETS.corpusPatternDefault;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new WikiUsageError(
      `option --limit must be a positive integer (1-${DISTILL_BUDGETS.patternsPerRun})`,
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed > DISTILL_BUDGETS.patternsPerRun) {
    throw new WikiUsageError(`option --limit exceeds ${DISTILL_BUDGETS.patternsPerRun}`);
  }
  return parsed;
}

/* ------------------------------- RPC 通路 ------------------------------- */

/** 从 IPC status 的 webUrl fragment 捕获 web token（daemon 唯一对外授权面）。 */
function webTokenOf(status: DaemonStatus): string | null {
  if (!status.webUrl) return null;
  const parsed = new URL(status.webUrl);
  return new URLSearchParams(parsed.hash.replace(/^#/, "")).get("token");
}

interface DistillRpcConnection {
  client: RpcClient;
  close: () => void;
}

/** 建立到 daemon /ws/rpc 的 oRPC 连接（token 来自 IPC status；本命令内闭合）。 */
async function connectDistillRpc(deps: WikiDistillCommandDeps): Promise<DistillRpcConnection> {
  const status = await deps.requestStatus();
  if (!status.active || status.port <= 0) {
    throw new Error("daemon RPC surface unavailable; run 'skill-creator start' first");
  }
  if (status.version !== deps.cliVersion) {
    throw new Error(
      `daemon ${status.version} owns the socket; CLI is ${deps.cliVersion} — run 'skill-creator start' to replace it`,
    );
  }
  const token = webTokenOf(status);
  if (!token) {
    throw new Error("daemon status carries no web token (webUrl fragment missing)");
  }
  const websocket = new WebSocket(
    `ws://127.0.0.1:${status.port}/ws/rpc?token=${encodeURIComponent(token)}`,
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      websocket.close();
      reject(new Error(`daemon RPC connection timed out after ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("daemon RPC connection failed (websocket error)"));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      websocket.removeEventListener("open", onOpen);
      websocket.removeEventListener("error", onError);
    };
    websocket.addEventListener("open", onOpen);
    websocket.addEventListener("error", onError);
  });
  const client = createORPCClient<RpcClient>(new RPCLink({ websocket }));
  return {
    client,
    close: () => websocket.close(),
  };
}

/* ------------------------------- 执行体 ------------------------------- */

interface DistillInvocation {
  io: CliIo;
  workspaceOption: string | undefined;
  limitOption: string | undefined;
  json: boolean;
  deps: WikiDistillCommandDeps;
}

async function runDistill(invocation: DistillInvocation): Promise<number> {
  const { io, json, deps } = invocation;
  // 用法错误（--limit 越界 / workspace ref 不可解析）在连接 daemon 前拒绝（exit 2）。
  const source = await deps.resolveSource(invocation.workspaceOption);
  const limit = parseDistillLimit(invocation.limitOption);
  const progress = (line: string): void => {
    // 进度一律走 stderr：--json 的 stdout 只含最终 JSON 文档（search 命令同纪律）。
    io.stderr(`${line}\n`);
  };

  let connection: DistillRpcConnection | undefined;
  try {
    progress(`starting distill for ${source} (limit ${limit})…`);
    connection = await connectDistillRpc(deps);
    const { runId } = await connection.client.wiki.distill.start({ source, limit });
    let status: DistillStatusOutput = await connection.client.wiki.distill.status({ runId });
    let printedState: RunState | null = null;
    while (!isTerminalRunState(status.state)) {
      if (status.state !== printedState) {
        printedState = status.state;
        const pending = status.proposalRefs.filter((ref) => ref.status === "pending").length;
        progress(
          status.state === "awaiting-approval"
            ? `run ${runId}: awaiting approval (${pending} proposal(s)) — approve or reject them in the skill-creator proposal face; this command waits for the run to converge`
            : `run ${runId}: ${status.state}`,
        );
      }
      await sleep(STATUS_POLL_INTERVAL_MS);
      status = await connection.client.wiki.distill.status({ runId });
    }
    if (json) {
      io.stdout(`${JSON.stringify(status, null, 2)}\n`);
    } else {
      printHumanSummary(io, status);
    }
    return status.state === "completed" ? 0 : 1;
  } catch (error) {
    if (error instanceof WikiUsageError) throw error;
    io.stderr(`wiki distill: ${describeRpcFailure(error)}\n`);
    return 1;
  } finally {
    connection?.close();
  }
}

/** typed RPC 失败投影：ORPCError 携带闭集 code（DISTILL_* 等）——`<code>: <message>`。 */
function describeRpcFailure(error: unknown): string {
  if (error instanceof ORPCError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** 人读终态投影：状态行 + reason + 非零 counters 摘要 + 逐项结果表（stdout）。 */
function printHumanSummary(io: CliIo, status: DistillStatusOutput): void {
  const reason = status.reason === null ? "" : ` (reason: ${status.reason})`;
  io.stdout(`distill run ${status.runId}: ${status.state}${reason}\n`);
  const counters = (Object.entries(status.counters) as Array<[string, number]>).filter(
    ([, count]) => count > 0,
  );
  if (counters.length > 0) {
    io.stdout(`counters: ${counters.map(([key, count]) => `${key}=${count}`).join("  ")}\n`);
  }
  if (status.proposalRefs.length === 0) {
    io.stdout("no plan items reached the ledger (model-invalid-only runs have no ledger rows)\n");
    return;
  }
  io.stdout("items:\n");
  for (const ref of [...status.proposalRefs].sort((left, right) => left.ordinal - right.ordinal)) {
    io.stdout(
      `  #${String(ref.ordinal).padEnd(4)}${ref.status.padEnd(14)}${ref.proposalId ?? "-"}\n`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
