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
 *   [3] 删除面（R14-C 2026-09-12）：listDayBuckets 按目录段投影日期桶；
 *       remove 删除会话目录并撤索引（空日期目录顺带修剪）。保留在本存储是
 *       因为 YYYY/MM/DD 布局与 sessionId→dir 索引都由它唯一持有，外层删除
 *       会留下 ghost 索引。
 * 妥协声明：写入 best-effort——追加失败只记日志不打断 live 会话（转录是投影，
 * 不是 authority）；磁盘无淘汰，转录体积由会话规模自然约束。
 */
import fs from "node:fs";
import path from "node:path";
import {
  DshAgentModeSchema,
  DshSessionStreamFrameSchema,
  type DshAgentMode,
  type DshSessionStreamFrame,
} from "../../shared/contracts/dsh-runtime.js";
import type { AgentSessionSummary } from "../../shared/contracts/agent.js";

/** 转录元数据（meta.json；全部字段按外部输入 safeParse）。 */
export interface SessionTranscriptMeta {
  sessionId: string;
  title: string;
  createdAt: string;
  cwd: string;
  /** 会话模式（add-agent-settings-modes；缺失/非法读 free——旧会话创建时即全工具面）。 */
  mode: DshAgentMode;
}

/** 日期桶（目录段 YYYY/MM/DD 的投影；R14-C 清理消费）。 */
export interface SessionDayBucket {
  /** 目录日期（段解释为本地时区当日午夜的时间戳）。 */
  dateMs: number;
  /** 该日期目录下的会话 ID。 */
  sessionIds: string[];
}

/** 存储接口（agent-sessions 依赖；测试可注入任意根目录）。 */
export interface SessionTranscripts {
  /** 记录会话起点（建目录 + meta.json 原子写）。 */
  recordStart(meta: SessionTranscriptMeta): void;
  /** 追加一帧（未知 sessionId 静默跳过——recordStart 未覆盖的帧不属于本存储）。 */
  append(sessionId: string, frame: DshSessionStreamFrame): void;
  /** 原子更新会话模式（meta.json 重写；未知 sessionId 返回 false）。 */
  updateMode(sessionId: string, mode: DshAgentMode): boolean;
  /** 原子更新会话标题（内核 session/title 事件；未知/空标题返回 false）。 */
  updateTitle(sessionId: string, title: string): boolean;
  /** 全部持久会话元数据（扫描 + 逐项 safeParse，损坏目录跳过）。 */
  listAll(): SessionTranscriptMeta[];
  /** 单会话帧回放（seq 升序；损坏行丢弃）。 */
  readFrames(sessionId: string): DshSessionStreamFrame[];
  /** 按目录段列出日期桶（索引视图；畸形段已在 hydrate/建目录时排除）。 */
  listDayBuckets(): SessionDayBucket[];
  /** 删除一个会话目录（撤索引 + 递归删 + 修剪空日期目录；未知返回 false）。 */
  remove(sessionId: string): boolean;
}

/** meta.json 的 runtime 收窄（外部输入；mode 缺失/非法 → free 的事实投影）。 */
function parseMeta(raw: unknown): SessionTranscriptMeta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const meta = raw as {
    sessionId?: unknown;
    title?: unknown;
    createdAt?: unknown;
    cwd?: unknown;
    mode?: unknown;
  };
  if (typeof meta.sessionId !== "string" || meta.sessionId.length === 0) return null;
  if (typeof meta.createdAt !== "string" || meta.createdAt.length === 0) return null;
  return {
    sessionId: meta.sessionId,
    title: typeof meta.title === "string" ? meta.title : "",
    createdAt: meta.createdAt,
    cwd: typeof meta.cwd === "string" ? meta.cwd : "",
    mode: DshAgentModeSchema.safeParse(meta.mode).success ? (meta.mode as DshAgentMode) : "free",
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

  /** 删除后修剪空的 YYYY/MM/DD 目录链（best-effort；非空/异常跳过）。 */
  function pruneEmptyDateDirs(): void {
    for (const year of safeDirs(rootDir)) {
      const yearDir = path.join(rootDir, year);
      for (const month of safeDirs(yearDir)) {
        const monthDir = path.join(yearDir, month);
        for (const day of safeDirs(monthDir)) {
          const dayDir = path.join(monthDir, day);
          if (safeDirs(dayDir).length === 0) {
            try {
              fs.rmdirSync(dayDir);
            } catch {
              // 非空或并发写入：保留。
            }
          }
        }
        if (safeDirs(monthDir).length === 0) {
          try {
            fs.rmdirSync(monthDir);
          } catch {
            // 同上。
          }
        }
      }
      if (safeDirs(yearDir).length === 0) {
        try {
          fs.rmdirSync(yearDir);
        } catch {
          // 同上。
        }
      }
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
    updateMode(sessionId, mode) {
      const dir = dirs.get(sessionId);
      if (dir === undefined) return false;
      try {
        const meta = parseMeta(JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")));
        if (meta === null || meta.mode === mode) return meta !== null;
        const next = { ...meta, mode };
        const target = path.join(dir, "meta.json");
        const tmp = `${target}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
        fs.renameSync(tmp, target);
        return true;
      } catch (error) {
        console.error(`[session-transcripts] updateMode failed for ${sessionId}:`, error);
        return false;
      }
    },
    updateTitle(sessionId, title) {
      const trimmed = title.trim();
      if (trimmed.length === 0) return false;
      const dir = dirs.get(sessionId);
      if (dir === undefined) return false;
      try {
        const meta = parseMeta(JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")));
        if (meta === null || meta.title === trimmed) return meta !== null;
        const next = { ...meta, title: trimmed };
        const target = path.join(dir, "meta.json");
        const tmp = `${target}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
        fs.renameSync(tmp, target);
        return true;
      } catch (error) {
        console.error(`[session-transcripts] updateTitle failed for ${sessionId}:`, error);
        return false;
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
    listDayBuckets() {
      hydrate();
      const buckets = new Map<string, SessionDayBucket>();
      for (const [sessionId, dir] of dirs) {
        // 目录段 = rootDir/YYYY/MM/DD/<sessionId>；畸形段跳过（hydrate/建目录已
        // 保证常规形状，这里防御并发改名等异常布局）。
        const segments = path.relative(rootDir, dir).split(path.sep);
        if (segments.length !== 4) continue;
        const [year, month, day] = segments;
        if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) continue;
        const dateMs = new Date(Number(year), Number(month) - 1, Number(day)).getTime();
        if (Number.isNaN(dateMs)) continue;
        const key = `${year}/${month}/${day}`;
        const bucket = buckets.get(key) ?? { dateMs, sessionIds: [] };
        bucket.sessionIds.push(sessionId);
        buckets.set(key, bucket);
      }
      return [...buckets.values()].sort((a, b) => b.dateMs - a.dateMs);
    },
    remove(sessionId) {
      hydrate();
      const dir = dirs.get(sessionId);
      if (dir === undefined) return false;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        console.error(`[session-transcripts] remove failed for ${sessionId}:`, error);
        return false; // 索引保留：目录可能仍在。
      }
      dirs.delete(sessionId);
      pruneEmptyDateDirs();
      return true;
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
    mode: meta.mode,
  };
}
