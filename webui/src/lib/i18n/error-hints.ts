/**
 * 用户原始需求 [2026-10-05]（Owner 裁决，webui-i18n-bilingual task 4.5 δ 线）：
 * 「客观留存这个错误，是调试的关键，但是可以辅助一些 i18n 的比较宽泛的翻译」。
 * 正交意图：
 *   [1] 错误分类器（纯函数）：对错误原文做宽泛家族识别（errno/code 前缀 +
 *       git/网络/JSON parse 等常见文本模式），返回域词典 key；未匹配返回
 *       null——展示层只显示原文，零降级。
 *   [2] 原文永不改写：本模块不消费、不包装、不翻译错误文本；翻译发生在
 *       展示层（t(key) 主显 + 原文次行/title）。
 * 妥协声明：规则按「宽泛优先」设计（Owner 明示宽泛翻译）；家族重叠时按
 * 规则数组顺序取首个命中（specific → general），不追求精确归因。
 */
import type { errorHintsEn } from "./catalogs/domains/error-hints.js";

/** errorHints 域词典 key（与域文件 keyof 联动，缺键即编译失败）。 */
export type ErrorHintKey = keyof typeof errorHintsEn;

/** 单条分类规则：家族 key + 文本模式集（任一命中即归入该家族）。 */
interface ErrorHintRule {
  key: ErrorHintKey;
  patterns: readonly RegExp[];
}

/**
 * 分类矩阵（顺序 = 优先级，specific → general）。
 * errno 码按整词大写匹配（\b 防止 ENOENT/ENOTFOUND 互吞）；句子模式忽略
 * 大小写。已知真实信源：Node fs（errno 前缀）、DomainError/oRPC 契约消息
 * （contracts/errors.ts + creator/repository service）、git stderr、
 * undici fetch、connection store 三条固定文案。
 */
const ERROR_HINT_RULES: readonly ErrorHintRule[] = [
  {
    key: "errorHints.permission",
    patterns: [
      /\bEACCES\b/,
      /\bEPERM\b/,
      /permission denied/i,
      /operation not permitted/i,
      /access denied/i,
      /\bforbidden\b/i,
    ],
  },
  {
    key: "errorHints.git",
    patterns: [
      /fatal:/i,
      /authentication failed/i,
      /(could not|failed to) clone/i,
      /clone failed/i,
      /unable to access/i,
      /remote:/i,
      /\bgit\b/i,
    ],
  },
  {
    key: "errorHints.disconnected",
    patterns: [
      /not connected/i,
      /connection closed/i,
      /disconnected/i,
      /connection (was )?lost/i,
      /socket hang up/i,
      /cannot authenticate/i,
      /closed unexpectedly/i,
    ],
  },
  {
    key: "errorHints.network",
    patterns: [
      /\bE(TIMEDOUT|CONNREFUSED|CONNRESET|CONNABORTED|AI_AGAIN|HOSTUNREACH|NETUNREACH|PROTO|NOTFOUND)\b/,
      /fetch failed/i,
      /timed out|timeout/i,
      /getaddrinfo/i,
      /\bnetwork\b/i,
      /\bwebsocket\b/i,
    ],
  },
  {
    key: "errorHints.conflict",
    patterns: [
      /conflict/i,
      /already exists/i,
      /changed on disk/i,
      /already entered execution/i,
      /retry a fresh run/i,
    ],
  },
  {
    key: "errorHints.invalidData",
    patterns: [
      /unexpected (token|end)/i,
      /\bjson\b/i,
      /\bpars(e|ed|es|ing)\b/i,
      /\binvalid\b/i,
      /frontmatter/i,
      /\bcorrupt/i,
      /\bmalformed\b/i,
    ],
  },
  {
    key: "errorHints.notFound",
    patterns: [/\bENOENT\b/, /no such file/i, /not found/i, /does not exist/i],
  },
  {
    key: "errorHints.io",
    patterns: [
      /\bE(IO|ROFS|NOSPC|EMFILE|ENFILE|NOTDIR|ISDIR|BADF|XDEV)\b/,
      /no space left/i,
      /disk quota/i,
      /read-only file system/i,
      /cross-device/i,
    ],
  },
  {
    key: "errorHints.invalidOperation",
    patterns: [/not valid/i, /not allowed/i, /unsupported/i],
  },
  {
    key: "errorHints.unavailable",
    patterns: [/unavailable/i, /shutting down/i, /session expired/i, /\b503\b/],
  },
  {
    key: "errorHints.cancelled",
    patterns: [/\babort(ed|error)?\b/i, /cancel(l)?ed/i],
  },
];

/**
 * 对错误原文做宽泛家族分类。空串/未匹配返回 null（展示层只渲染原文）。
 * 纯函数：无 locale 依赖、无副作用；翻译由展示层 t(key) 完成。
 */
export function classifyErrorHint(raw: string): ErrorHintKey | null {
  if (!raw) return null;
  for (const rule of ERROR_HINT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(raw))) return rule.key;
  }
  return null;
}
