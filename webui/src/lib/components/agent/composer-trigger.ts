/**
 * Composer 触发检测内核（openspec composer-capability-parity W3）。
 *
 * 用户指示 [2026-09-15]：「……100% 复刻官方 webui 输入框能力的实现。」官方
 * ui-input-trigger detect.ts 语义的产品化：触发符 `/`（命令 + 技能统一）、
 * URL 剔除（`//` 协议相对与 `://` scheme 不激发）、claim 状态机（claimed 态
 * 压制 `/` 触发；提交时剥离 claim token 只留 args）。
 *
 * 正交意图：
 *   [1] 检测文法：首行前缀触发 + URL 剔除 + claim 压制（纯函数）。
 *   [2] claim 机：draft 前缀保持 claim 存活；Space 同步落 claim；提交剥 token。
 */

/** claim 激活中的命令 token（含尾随空格，如 "/role "）。 */
export interface TriggerClaim {
  token: string;
}

/**
 * 触发查询（首行文法）：行以 `/` 开头才产生 query；URL 剔除——`//` 开头
 * （协议相对 URL）或行内含 `://`（scheme）时不激发（官方 carve-outs 同法）。
 * 返回空串 = 菜单关闭。
 */
export function slashQuery(firstLine: string): string {
  if (!firstLine.startsWith("/")) return "";
  if (firstLine.startsWith("//")) return "";
  const head = firstLine.split(/\s/, 1)[0] ?? "";
  if (head.includes("://")) return "";
  return firstLine;
}

/** claimed 态下 `/` 触发被压制（官方 guard tier：claimed → `/` 冻结）。 */
export function slashSuppressedByClaim(claim: TriggerClaim | null): boolean {
  return claim !== null;
}

/**
 * claim 存活判定：draft 以 claim token 开头时 claim 保持（官方：claim 在
 * draft startsWith(token) 期间存活——退格删掉 token 即退出 claim）。
 */
export function claimSurvives(claim: TriggerClaim | null, draft: string): TriggerClaim | null {
  if (claim === null) return null;
  return draft.startsWith(claim.token) ? claim : null;
}

/**
 * Space 同步落 claim（官方 matchSpace）：输入中的命令 token 是完整候选且
 * 尾随空格时立即 claim（无需等 Enter 裁决）。
 */
export function claimOnSpace(draft: string, commandTokens: readonly string[]): TriggerClaim | null {
  const head = draft.split(/\s/, 1)[0] ?? "";
  if (!head.startsWith("/")) return null;
  const token = `${head} `;
  return commandTokens.includes(token) && draft.startsWith(token) ? { token } : null;
}

/** 提交剥离：claim token 只留 args（官方 argsAfter(token) 同法）。 */
export function stripClaimedToken(text: string, claim: TriggerClaim | null): string {
  if (claim === null) return text;
  if (!text.startsWith(claim.token)) return text;
  return text.slice(claim.token.length);
}

/**
 * 官方 matchEnter 的同步投影：Enter 时若首 token 命中命令目录则视为 claim
 * 落定（提交路径由上层裁决——本函数只给判定）。
 */
export function claimOnEnter(draft: string, commandTokens: readonly string[]): TriggerClaim | null {
  return claimOnSpace(draft, commandTokens);
}
