/**
 * Manager store 目录的进程生命周期 inode 锚（openspec skill-steward-runtime 2.3e；
 * Codex R13 P2-1/P2-2 残余的 owner）。
 *
 * 用户原始需求 [2026-09-06]（transaction-contract.md）：「普通失败补偿到原状态；
 * 补偿遇到外部修改或 I/O 错误时进入 recovery-required」。
 * Codex R13 复核：操作内身份复验无法检测「调用前」的同路径目录换体——一次新调用
 * 看到的 canonical 目录未必是 daemon 生命周期内一直持有的那个。
 *
 * 正交意图：
 *   [1] 首见锚定：本进程第一次成功通过 canonical 校验的 Manager 事实目录
 *       （journal 目录 / backup root / store 根）记录 {dev,ino}。
 *   [2] 跨调用复验：后续每次使用都比对锚——同路径换体（rename 顶替）即
 *       UNAVAILABLE/recovery-required，替换目录不能成为新的 Manager 事实源。
 * 妥协声明：锚是进程内存态——daemon 重启后重新首见锚定（重启前的换体成为新真相，
 *   属于人工恢复决策面）；显式 boot 接线由 store 初始化路径调用 anchorManagerDirectory。
 */
import { DomainError } from "../domain-error.js";
import { assertCanonicalDirectory, type DirIdentity } from "./dir-identity.js";

const anchors = new Map<string, DirIdentity>();

/**
 * 首见锚定：canonical 校验通过后记录身份；已锚定的目录返回时同时复验
 * （换体 → UNAVAILABLE/recovery-required）。调用方必须已确保目录存在。
 */
export async function anchorManagerDirectory(dir: string): Promise<DirIdentity> {
  const identity = await assertCanonicalDirectory(dir);
  const key = dir.endsWith("/") ? dir.slice(0, -1) : dir;
  const anchored = anchors.get(key);
  if (anchored === undefined) {
    anchors.set(key, identity);
    return identity;
  }
  if (anchored.dev !== identity.dev || anchored.ino !== identity.ino) {
    throw new DomainError(
      "UNAVAILABLE",
      `manager directory was replaced during this daemon lifetime (inode drift vs first-seen anchor); recovery required: ${dir}`,
    );
  }
  return identity;
}

/** 复验已锚定目录（未锚定 = no-op，保持调用方原有行为）。 */
export async function verifyAnchoredDirectory(dir: string): Promise<void> {
  const key = dir.endsWith("/") ? dir.slice(0, -1) : dir;
  if (!anchors.has(key)) return;
  await anchorManagerDirectory(dir);
}

/** 测试/重启等价：清空进程内锚表。 */
export function resetStoreAnchors(): void {
  anchors.clear();
}
