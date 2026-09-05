/**
 * 原始需求 [2026-07-27]：「源卡片展示上次扫描的缓存元数据（skill 数 / commit，来自 daemon scan session）。
 * 缓存仅活在当前会话的 home Tab 作用域内，不持久化跨重启、不写 localStorage。」
 * 正交意图：
 *   [1] 在 home Tab 会话作用域内按 source id 缓存扫描摘要投影。
 *   [2] 实例 Tab 完成扫描时回写对应 source id 的摘要，互不覆盖。
 */
/** 一条源在当前会话内的扫描摘要投影（不持久化）。 */
export interface ScanSummary {
  /** 缓存的技能数。 */
  skillCount: number;
  /** 上次扫描固定的 commit 前 12 位。 */
  commitPrefix: string;
  /** 缓存写入时间戳（用于 stale 判定）。 */
  scannedAt: number;
}

const STALE_MS = 5 * 60 * 1000;

/** home Tab 会话作用域的扫描摘要缓存（module 单例 = 当前会话，刷新即重置）。 */
const summaryBySource = $state<Map<string, ScanSummary>>(new Map());

/** 读取一条源的扫描摘要；未扫描返回 `undefined`。 */
export function getScanSummary(sourceId: string): ScanSummary | undefined {
  return summaryBySource.get(sourceId);
}

/** 实例 Tab 完成扫描后回写摘要（仅当前会话可见）。 */
export function recordScanSummary(
  sourceId: string,
  summary: { skillCount: number; commit: string },
): void {
  summaryBySource.set(sourceId, {
    skillCount: summary.skillCount,
    commitPrefix: summary.commit.slice(0, 12),
    scannedAt: Date.now(),
  });
}

/** 清空会话内全部摘要（测试或重置用）。 */
export function clearScanSummaries(): void {
  summaryBySource.clear();
}

/** 判断一条摘要是否过时（仅 UI hint，不自动扫描）。 */
export function isScanSummaryStale(summary: ScanSummary | undefined): boolean {
  if (!summary) return false;
  return Date.now() - summary.scannedAt > STALE_MS;
}
