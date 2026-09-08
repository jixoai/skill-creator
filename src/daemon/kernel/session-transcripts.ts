/**
 * 面板会话转录存储（产品自有持久层）。
 *
 * 用户原始需求 [2026-09-08]：「如果可以，将会话存储到 ~/.skill-creator/sessions/
 * 目录呢，基于时间归类：~/.skill-creator/sessions/YYYY/MM/DD/sessionid」——
 * daemon 重启后面板会话可见、可回放、可经内核 resume 续聊。
 *
 * 正交意图：
 *   [1] write-through 投影：live 帧环产出的脱敏 DshSessionStreamFrame 逐行追加
 *       到 sessions/YYYY/MM/DD/<sessionId>/frames.jsonl（内核 zstd 日志是 LLM
 *       事实源，本层只存面板转录）。
 *   [2] 读面：listAll/readFrames 以 meta.json + 逐行 safeParse 投影；损坏行按
 *       集合读取法则丢弃，单会话故障不拖垮列表。
 * 妥协声明：写入 best-effort——追加失败只记日志不打断 live 会话（转录是投影，
 * 不是 authority）；磁盘无淘汰，转录体积由会话规模自然约束。
 */
import fs from "node:fs";
import path from "node:path";
import {
  DshSessionStreamFrameSchema,
  type DshSessionStreamFrame,
} from "../../shared/contracts/dsh-runtime.js";
import type { AgentSessionSummary } from "../../shared/contracts/agent.js";

/** 转录元数据（meta.json；全部字段按外部输入 safeParse）。 */
export interface SessionTranscriptMeta {
  sessionId: string;
  title: string;
  createdAt: string;
  cwd: string;
}

/** 存储接口（agent-sessions 依赖；测试可注入任意根目录）。 */
export interface SessionTranscripts {
  /** 记录会话起点（建目录 + meta.json 原子写）。 */
  recordStart(meta: SessionTranscriptMeta): void;
  /** 追加一帧（未知 sessionId 静默跳过——recordStart 未覆盖的帧不属于本存储）。 */
  append(sessionId: string, frame: DshSessionStreamFrame): void;
  /** 全部持久会话元数据（扫描 + 逐项 safeParse，损坏目录跳过）。 */
  listAll(): SessionTranscriptMeta[];
  /** 单会话帧回放（seq 升序；损坏行丢弃）。 */
  readFrames(sessionId: string): DshSessionStreamFrame[];
}

/** meta.json 的 runtime 收窄（外部输入）。 */
function parseMeta(raw: unknown): SessionTranscriptMeta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const meta = raw as { sessionId?: unknown; title?: unknown; createdAt?: unknown; cwd?: unknown };
  if (typeof meta.sessionId !== "string" || meta.sessionId.length === 0) return null;
  if (typeof meta.createdAt !== "string" || meta.createdAt.length === 0) return null;
  return {
    sessionId: meta.sessionId,
    title: typeof meta.title === "string" ? meta.title : "",
    createdAt: meta.createdAt,
    cwd: typeof meta.cwd === "string" ? meta.cwd : "",
  };
}

/** ISO 时间 → YYYY/MM/DD 目录段（非法日期回退当日）。 */
function dateSegments(iso: string): [string, string, string] {
  const date = new Date(iso);
  const valid = !Number.isNaN(date.getTime());
  const y = valid ? String(date.getFullYear()) : String(new Date().getFullYear());
  const m = valid ? String(date.getMonth() + 1).padStart(2, "0") : "01";
  const d = valid ? String(date.getDate()).padStart(2, "0") : "01";
  return [y, m, d];
}

export function createSessionTranscripts(rootDir: string): SessionTranscripts {
  /** sessionId → 会话目录（recordStart 注册；hydrate 扫描补全）。 */
  const dirs = new Map<string, string>();
  let hydrated = false;

  function sessionDir(meta: { sessionId: string; createdAt: string }): string {
    const [y, m, d] = dateSegments(meta.createdAt);
    return path.join(rootDir, y, m, d, meta.sessionId);
  }

  /** 启动后首次读面时扫描既有目录（幂等）。 */
  function hydrate(): void {
    if (hydrated) return;
    hydrated = true;
    let years: string[] = [];
    try {
      years = fs
        .readdirSync(rootDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      return; // 根目录不存在：尚无持久会话。
    }
    for (const year of years) {
      for (const month of safeDirs(path.join(rootDir, year))) {
        for (const day of safeDirs(path.join(rootDir, year, month))) {
          for (const sid of safeDirs(path.join(rootDir, year, month, day))) {
            if (!dirs.has(sid)) dirs.set(sid, path.join(rootDir, year, month, day, sid));
          }
        }
      }
    }
  }

  function safeDirs(dir: string): string[] {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  return {
    recordStart(meta) {
      try {
        const dir = sessionDir(meta);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const target = path.join(dir, "meta.json");
        const tmp = `${target}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(meta)}\n`, { mode: 0o600 });
        fs.renameSync(tmp, target);
        dirs.set(meta.sessionId, dir);
      } catch (error) {
        console.error(`[session-transcripts] recordStart failed for ${meta.sessionId}:`, error);
      }
    },
    append(sessionId, frame) {
      try {
        const dir = dirs.get(sessionId);
        if (dir === undefined) return;
        fs.appendFileSync(path.join(dir, "frames.jsonl"), `${JSON.stringify(frame)}\n`, {
          mode: 0o600,
        });
      } catch (error) {
        console.error(`[session-transcripts] append failed for ${sessionId}:`, error);
      }
    },
    listAll() {
      hydrate();
      const metas: SessionTranscriptMeta[] = [];
      for (const dir of dirs.values()) {
        try {
          const meta = parseMeta(JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")));
          if (meta !== null) metas.push(meta);
        } catch {
          // meta 缺失/损坏：跳过该目录（集合读取丢弃无效条目）。
        }
      }
      metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return metas;
    },
    readFrames(sessionId) {
      hydrate();
      const dir = dirs.get(sessionId);
      if (dir === undefined) return [];
      let lines: string[] = [];
      try {
        lines = fs.readFileSync(path.join(dir, "frames.jsonl"), "utf8").split("\n");
      } catch {
        return [];
      }
      const frames: DshSessionStreamFrame[] = [];
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        try {
          const parsed = DshSessionStreamFrameSchema.safeParse(JSON.parse(line));
          if (parsed.success) frames.push(parsed.data);
        } catch {
          // 损坏行丢弃。
        }
      }
      frames.sort((a, b) => a.seq - b.seq);
      return frames;
    },
  };
}

/** 持久元数据 → 面板摘要（status 固定 disposed；live 态由调用方覆盖）。 */
export function summaryOfMeta(meta: SessionTranscriptMeta): AgentSessionSummary {
  return {
    sessionId: meta.sessionId,
    title: meta.title,
    status: "disposed",
    cwd: meta.cwd || process.cwd(),
    createdAt: meta.createdAt,
  };
}
