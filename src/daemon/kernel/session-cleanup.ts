/**
 * 面板会话清理服务（R14-C 2026-09-12）。
 *
 * 用户原始需求 [2026-09-12]：「要有专门的 Session 管理页面，并且要默认支持
 * 清理 30 天以外的 Session（可配置）。」——按目录日期删除产品转录层
 * （sessions/YYYY/MM/DD/<sessionId>，由 session-transcripts 持有），并释放
 * 对应的 live 面板句柄；running 会话跳过。
 *
 * 正交意图：
 *   [1] 清理核心：beforeDays（目录日期 < now - N 天）/ all / 显式 sessionIds
 *       三种范围，逐会话「running 跳过 → live 释放 → 目录删除」，typed summary
 *       （deleted/kept/errors 有界）。
 *   [2] boot 钩子：daemon 启动时按 settings.session.sessionCleanupDays 自动扫
 *       一遍过期转录（有界 try/catch，失败只记日志不影响启动）。
 * 妥协声明：[1][2] 同文件——boot 钩子是清理核心的唯一自动触发器，拆分会造成
 * 循环依赖。风险边界：本层绝不触碰 $DSH_HOME 内核会话日志（LLM 历史事实源），
 * 内核侧清理是后续项；时钟可注入（测试边界 beforeDays=0）。
 */
import type {
  AgentSessionsCleanupInput,
  AgentSessionsCleanupResult,
} from "../../shared/contracts/agent.js";
import type { SessionTranscripts } from "./session-transcripts.js";

/** 每天的毫秒数（目录日期比较粒度）。 */
const MS_PER_DAY = 86_400_000;
/** errors 数组的有界上限（防失控 fs 故障撑爆 RPC 载荷）。 */
const MAX_DELETED_IDS = 1000;
const MAX_CLEANUP_ERRORS = 20;

/** agent-sessions 服务的 live 控制面（清理需要的状态查询与句柄释放）。 */
export interface SessionCleanupLiveControl {
  /** live 面板状态：running 会话不可清理；persisted = 无 live 句柄。 */
  liveStatusOf(sessionId: string): "running" | "live" | "persisted";
  /** 释放并移除非 running 的 live 条目（幂等；未知/已移除 no-op）。 */
  disposeLiveSession(sessionId: string): Promise<void>;
  /** 清理门（R15 codex P1-2）：fn（释放+删转录全程）期间阻断该 id 的复活。 */
  runUnderCleanupGate(sessionId: string, fn: () => Promise<void>): Promise<void>;
  /** 墓碑（R15 终验）：删除成功后永久拒绝复活（覆盖飞行中恢复的迟到交错）。 */
  markCleaned(sessionId: string): void;
}

/** 清理核心依赖（transcripts 持有布局；control 由 agent-sessions 实现）。 */
export interface SessionCleanupDeps {
  transcripts: SessionTranscripts;
  control: SessionCleanupLiveControl;
  /** 时钟注入（缺省 Date；测试用 beforeDays=0 边界或固定 now）。 */
  now?: () => Date;
}

function errorMessage(sessionId: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${sessionId}: ${detail.slice(0, 160)}`;
}

/**
 * 清理核心（纯过程，无内核依赖）：kept = 清理后仍留存的持久会话数——
 * 太新、running 被跳过、删除失败的条目都计入。
 */
export async function runSessionCleanup(
  deps: SessionCleanupDeps,
  input: AgentSessionsCleanupInput,
): Promise<AgentSessionsCleanupResult> {
  const nowMs = (deps.now ?? (() => new Date()))().getTime();
  // cutoff 语义：目录日期（本地午夜）< cutoff 才可删。
  // - beforeDays → now - N 天（N=0 时今天午夜 < now，当日也会被清理——boot 边界）；
  // - all:true → +Infinity；all:false → -Infinity（无候选）；
  // - sessionIds → 显式名单（cutoff 无效，名单即范围）。
  let cutoff: number;
  let targets: ReadonlySet<string> | null = null;
  if ("beforeDays" in input) {
    cutoff = nowMs - input.beforeDays * MS_PER_DAY;
  } else if ("sessionIds" in input) {
    cutoff = Number.POSITIVE_INFINITY;
    targets = new Set(input.sessionIds);
  } else {
    cutoff = input.all ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }

  let deleted = 0;
  let kept = 0;
  const deletedIds: string[] = [];
  let deletedIdsTruncated = false;
  const errors: string[] = [];
  for (const bucket of deps.transcripts.listDayBuckets()) {
    const bucketOld = bucket.dateMs < cutoff;
    for (const sessionId of bucket.sessionIds) {
      if (targets !== null && !targets.has(sessionId)) continue;
      if (!bucketOld) {
        kept++;
        continue;
      }
      const status = deps.control.liveStatusOf(sessionId);
      if (status === "running") {
        kept++;
        continue;
      }
      try {
        let removed = false;
        await deps.control.runUnderCleanupGate(sessionId, async () => {
          if (status === "live") await deps.control.disposeLiveSession(sessionId);
          removed = deps.transcripts.remove(sessionId);
          // 墓碑必须在**同一门内**写入（codex R15 追加 P1-2：门 finally 解除后才
          // markCleaned 存在交错缝隙——删除成功与墓碑落地原子过渡）。
          if (removed) deps.control.markCleaned(sessionId);
        });
        if (removed) {
          deleted++;
          // 契约上限 1000：溢出置 truncated 旗标（客户端对截断结果走列表复核
          // 而非仅靠 includes 失效当前会话——codex R15 终验 P1-5）。
          if (deletedIds.length < MAX_DELETED_IDS) deletedIds.push(sessionId);
          else deletedIdsTruncated = true;
        } else kept++;
      } catch (error) {
        if (errors.length < MAX_CLEANUP_ERRORS) errors.push(errorMessage(sessionId, error));
        kept++;
      }
    }
  }
  return {
    kind: "summary",
    deleted,
    kept,
    ...(deletedIds.length > 0 ? { deletedIds } : {}),
    ...(deletedIdsTruncated ? { deletedIdsTruncated: true } : {}),
    ...(errors.length > 0 ? { errors } : {}),
  };
}

/** boot 钩子依赖（daemon index 注入；cleanupDays 读 settings 投影）。 */
export interface BootSessionCleanupDeps {
  cleanupDays: () => Promise<number>;
  cleanup: (beforeDays: number) => Promise<AgentSessionsCleanupResult>;
  log?: (message: string) => void;
}

/**
 * daemon 启动自动清理：按配置天数扫一遍过期转录（fire-and-forget；任何失败
 * 有界日志，绝不打断启动）。live map 在 boot 时为空，running 跳过在此路径
 * 天然不触发。
 */
export async function runBootSessionCleanup(deps: BootSessionCleanupDeps): Promise<void> {
  try {
    const days = await deps.cleanupDays();
    const result = await deps.cleanup(days);
    (deps.log ?? console.log)(
      `[session-cleanup] boot sweep (${days}d): deleted ${result.deleted}, kept ${result.kept}`,
    );
  } catch (error) {
    console.warn(
      `[session-cleanup] boot sweep failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
