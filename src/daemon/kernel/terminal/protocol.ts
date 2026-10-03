/**
 * 人类终端 typed JSON 协议（skills-agent-page design §4；r3/r4 消息语义冻结）。
 *
 * 用户原始需求 [2026-10-03]（design §4 定稿）：「transport 定稿：专用 /ws/terminal
 * 单端点……create/write/resize/exit/list 控制消息与 output/buffer/exit 通知同走
 * 该 WS 的 typed JSON 帧（双向 Zod schema 校验，非法帧 typed error 回执不杀终端）；
 * 按 sessionId 多路复用，一条 WS 承载多终端 tab。」
 *
 * 正交意图：
 *   [1] 客户端控制消息（create/write/resize/exit/buffer/list）的 wire 契约：
 *       双向 safeParse，非法帧 = typed error 回执，不终止终端连接。
 *   [2] 可靠性语义（r4）：output 帧带 per-session 单调 seq；create ack 带
 *       replayFrom（服务端缓冲首行 seq）；buffer 请求按缺口区间回放，已裁剪
 *       区间回 gap；write 带 reqId（客户端单调），server 高水位去重回执
 *       duplicate；resize 终值幂等；exit 对已退会话 typed error。
 *   [3] 服务端通知（created/output/buffer/gap/exit/duplicate/list/error）的
 *       wire 契约——与控制消息同一 WS 同一 JSON 信封。
 * 妥协声明：seq/reqId 是 per-session 单调整数（1 起）；协议层不承载鉴权
 *   （upgrade 期 ?token= web token 与 /ws/rpc 同法则）。
 */
import { z } from "zod";

/** 终端行列的合理值域（xterm 支持面收敛；越界 = 非法帧）。 */
const ColsSchema = z.number().int().min(2).max(500);
const RowsSchema = z.number().int().min(2).max(300);

/** write 单帧输入上限（字符）：键序注入的防滥用界。 */
export const TERMINAL_WRITE_MAX_CHARS = 128 * 1024;

/** gap 回放单响应的有界窗口（条目数上限——更大缺口由客户端分窗重放）。 */
export const TERMINAL_BUFFER_WINDOW_MAX_ENTRIES = 128;

/** 客户端控制消息（create/write/resize/exit/buffer/list）。 */
export const TerminalClientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("create"),
    cols: ColsSchema.optional(),
    rows: RowsSchema.optional(),
    /** 启动目录（绝对路径；只是默认 cwd，不是 sandbox——如实声明）。 */
    cwd: z.string().min(1).optional(),
    /** shell 探测覆盖（缺省 $SHELL / ComSpec / /bin/sh）。 */
    shell: z.string().min(1).optional(),
    /** 断线重连：附着既有会话 + seq 对账（不新建进程，不受并发上限约束）。 */
    resume: z.string().min(1).optional(),
  }),
  z.strictObject({
    type: z.literal("write"),
    sessionId: z.string().min(1),
    /** 客户端 per-session 单调（r4：write 非幂等——重送重复按键，需去重）。 */
    reqId: z.number().int().min(1),
    data: z.string().max(TERMINAL_WRITE_MAX_CHARS),
  }),
  z.strictObject({
    type: z.literal("resize"),
    sessionId: z.string().min(1),
    cols: ColsSchema,
    rows: RowsSchema,
  }),
  z.strictObject({
    type: z.literal("exit"),
    sessionId: z.string().min(1),
  }),
  z
    .strictObject({
      type: z.literal("buffer"),
      sessionId: z.string().min(1),
      /** 缺口区间 [from, to]（含端点；seq 1 起单调）。 */
      from: z.number().int().min(1),
      to: z.number().int().min(1),
    })
    .refine((message) => message.from <= message.to, {
      message: "buffer range needs from ≤ to",
    }),
  z.strictObject({
    type: z.literal("list"),
  }),
]);
/** 客户端控制消息。 */
export type TerminalClientMessage = z.infer<typeof TerminalClientMessageSchema>;

/** 终端会话的 list 投影条目。 */
export const TerminalSessionInfoSchema = z.strictObject({
  sessionId: z.string().min(1),
  /** 进程存活（false = 已退但转录缓冲仍可重放）。 */
  alive: z.boolean(),
  /** 宿主进程 pid（已退/被回收 = null）——进程回收证据面。 */
  pid: z.number().int().nullable(),
  exitCode: z.number().int().nullable(),
  createdAt: z.string().min(1),
  cols: ColsSchema,
  rows: RowsSchema,
  /** 附着的 WS 连接数（0 = 无人观看，参与 idle 判定）。 */
  attached: z.number().int().nonnegative(),
});
/** 终端会话信息。 */
export type TerminalSessionInfo = z.infer<typeof TerminalSessionInfoSchema>;

/** 服务端 typed error 码（闭集；非法帧/未知会话/上限/已退/内部失败）。 */
export const TerminalErrorCodeSchema = z.enum([
  "INVALID_JSON",
  "INVALID_MESSAGE",
  "SESSION_NOT_FOUND",
  "SESSION_EXITED",
  "LIMIT_EXCEEDED",
  "CREATE_FAILED",
  "INTERNAL",
]);
/** 终端错误码。 */
export type TerminalErrorCode = z.infer<typeof TerminalErrorCodeSchema>;

/** 环形缓冲的单条输出块（seq 与 data 原子对应——重放与缺口对账的单元）。 */
export const TerminalBufferEntrySchema = z.strictObject({
  seq: z.number().int().min(1),
  data: z.string(),
});
/** 缓冲块。 */
export type TerminalBufferEntry = z.infer<typeof TerminalBufferEntrySchema>;

/** 服务端通知（created/output/buffer/gap/exit/duplicate/list/error）。 */
export const TerminalServerMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("created"),
    sessionId: z.string().min(1),
    /** 服务端当前缓冲首行 seq（空缓冲 = 下一 seq；缺口对账基准）。 */
    replayFrom: z.number().int().min(1),
    cols: ColsSchema,
    rows: RowsSchema,
  }),
  z.strictObject({
    type: z.literal("output"),
    sessionId: z.string().min(1),
    /** per-session 单调递增（1 起）——客户端检测缺口 MUST 发 buffer 请求。 */
    seq: z.number().int().min(1),
    data: z.string(),
  }),
  z.strictObject({
    type: z.literal("buffer"),
    sessionId: z.string().min(1),
    /** 回放块（有界窗口；未覆盖完 [from,to] 由客户端按 seq 数学分窗续拉）。 */
    entries: z.array(TerminalBufferEntrySchema).max(TERMINAL_BUFFER_WINDOW_MAX_ENTRIES),
  }),
  z.strictObject({
    type: z.literal("gap"),
    sessionId: z.string().min(1),
    /** 缓冲已裁剪：现存最早 seq（客户端清屏重拉）。 */
    availableFrom: z.number().int().min(1),
  }),
  z.strictObject({
    type: z.literal("exit"),
    sessionId: z.string().min(1),
    exitCode: z.number().int(),
  }),
  z.strictObject({
    type: z.literal("duplicate"),
    sessionId: z.string().min(1),
    /** 被判重试的 write reqId（不注入 PTY）。 */
    reqId: z.number().int().min(1),
  }),
  z.strictObject({
    type: z.literal("list"),
    sessions: z.array(TerminalSessionInfoSchema),
  }),
  z.strictObject({
    type: z.literal("error"),
    code: TerminalErrorCodeSchema,
    message: z.string().min(1),
    sessionId: z.string().min(1).optional(),
  }),
]);
/** 服务端通知。 */
export type TerminalServerMessage = z.infer<typeof TerminalServerMessageSchema>;
