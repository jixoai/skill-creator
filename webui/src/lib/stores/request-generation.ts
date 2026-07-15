/**
 * 用户原始需求 [2026-07-15]：「按照你自己的节奏去推进开发迭代」。
 * 架构诊断：路由变化或 daemon 连接更替后的过期响应不得覆盖新请求产生的状态。
 * 正交意图：
 *   [1] 发放只允许最新请求与当前所有者提交结果的代次令牌。
 *   [2] 在所属状态被清理时主动失效所有未完成令牌。
 */

/** 单个异步请求提交完成结果的权限。 */
export interface RequestGeneration {
  isLatest(): boolean;
  isCurrent(): boolean;
}

/** 在同一所有者范围内单调替换旧请求的代次源。 */
export interface RequestGenerationGate {
  issue(): RequestGeneration;
  invalidate(): void;
}

/** 创建一个相互隔离、可绑定外部所有者世代的 latest-request-wins 代次门。 */
export function createRequestGenerationGate(
  getOwnerGeneration: () => number = detachedOwnerGeneration,
): RequestGenerationGate {
  let currentGeneration = 0;

  return {
    issue() {
      currentGeneration += 1;
      const generation = currentGeneration;
      const ownerGeneration = getOwnerGeneration();
      const isLatest = (): boolean => generation === currentGeneration;
      return {
        isLatest,
        isCurrent: () => isLatest() && ownerGeneration === getOwnerGeneration(),
      };
    },
    invalidate() {
      currentGeneration += 1;
    },
  };
}

function detachedOwnerGeneration(): number {
  return 0;
}
