/**
 * 生产 daemon 的 DSH 内核宿主生命周期（dsh-kernel-rebase task 2.1 改造；原
 * web 组合宿主形态退役——Skill Creator shell 是唯一宿主，DSH 只作 kernel）。
 *
 * 用户原始需求 [2026-09-08]：「我需要的是 DSH 的内核。也就是说在现有 skill
 * creator 的基础上。去实现一个 Agent 的产品。」
 *
 * 正交意图：
 *   [1] 内核挂载：daemon web 就绪后 boot headless 内核（单 dsh-base bundle；
 *       无 HTTP server、无 web 分区挂载）。
 *   [2] 降级恢复：boot 失败（DSH 缺失/版本不符/插件失败）不阻塞 daemon——
 *       显式记录原因（status.dsh 供 CLI/浏览器诊断），Manager 面照常服务。
 *   [3] 有界停止：dispose 关闭 cordis fiber + 还原 DSH_HOME env。
 * 妥协声明：boot 是 best-effort 前台步骤；降级后不自动重试——重启 daemon 是
 *   唯一恢复入口（与既有 4.1 重启验证语义一致）。
 */

/** 缺省 home：env DSH_HOME ?? ~/.dsh（与官方 storage 解析一致）。 */
function resolveDefaultDshHome(): string {
  const env = process.env.DSH_HOME;
  if (env && env.trim() !== "") return env;
  return `${process.env.HOME ?? ""}/.dsh`;
}

/** 生产 DSH 内核宿主句柄。 */
export interface ProductionDshKernelHost {
  mounted: boolean;
  /** 未挂载原因（降级诊断；DSH 缺失/版本错误/插件失败等）。 */
  reason?: string;
  /** 内核 boot facts（entries/activationOrder；无 port——内核无 HTTP 面）。 */
  record?: { entries: string[]; activationOrder: string[] };
  /** 运行中的内核句柄（mounted 时；session/agent 面消费，不进共享契约）。 */
  kernel?: Awaited<ReturnType<typeof bootForProduction>>;
  /** 有界停止：关闭 cordis fiber、还原 env。幂等。 */
  dispose(): Promise<void>;
}

export interface MountDshKernelHostOptions {
  /** DSH 存储 home（缺省用官方默认：env DSH_HOME ?? ~/.dsh）。 */
  dshHome?: string;
  /** 显式关闭（测试/逃生口；env SKILL_CREATOR_DSH_HOST=off 等效）。 */
  disabled?: boolean;
  /** skill-creator-mcp 端点（4.1b：内核组合 dsh-mcp-client 行连接 /mcp）。 */
  mcp?: { url: string; token: string };
}

// 延迟导入避免 daemon 主路径硬依赖 dsh-app-boot（bundle 已 externalize；测试
// 注入 fake 时不需要装包）。boot 失败统一降级，不抛出。
async function bootForProduction(home: string, mcp?: { url: string; token: string }) {
  const { bootDshKernel } = await import("./kernel/dsh-kernel.js");
  return bootDshKernel({ home, mcp });
}

/**
 * boot headless DSH 内核。任何失败都降级为 mounted:false + reason——daemon
 * 继续可用（Manager 面不依赖内核）。
 */
export async function mountDshKernelHost(
  options: MountDshKernelHostOptions = {},
): Promise<ProductionDshKernelHost> {
  if (options.disabled || process.env.SKILL_CREATOR_DSH_HOST === "off") {
    return { mounted: false, reason: "disabled by env", dispose: async () => {} };
  }
  let kernel: Awaited<ReturnType<typeof bootForProduction>> | null = null;
  try {
    kernel = await bootForProduction(options.dshHome ?? resolveDefaultDshHome(), options.mcp);
    let disposed = false;
    return {
      mounted: true,
      record: {
        entries: kernel.record.entries.map((entry) => entry.name),
        activationOrder: [...kernel.record.activationOrder],
      },
      kernel,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        await kernel!.dispose();
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await kernel?.dispose();
    } catch {
      // 半成品回收失败不掩盖降级主因。
    }
    return { mounted: false, reason, dispose: async () => {} };
  }
}
