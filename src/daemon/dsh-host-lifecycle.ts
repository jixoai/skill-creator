/**
 * 生产 daemon 的 DSH 组合宿主生命周期（openspec dsh-webui-composition 4.1）。
 *
 * 用户原始需求 [2026-09-07]（tasks 4.1）：「验证组合宿主启动/停止/重启；DSH 缺失/
 * 版本错误/插件失败」——daemon 默认入口切换为 DSH host，SPA 仅作恢复夹具。
 *
 * 正交意图：
 *   [1] 启动挂载：daemon web 就绪后 boot 官方 DSH profile 并同源挂载（Manager
 *       保留 /ws/rpc、/api/health、/manager/* 分区；DSH 承载其余路由）。
 *   [2] 降级恢复：boot 失败（DSH 缺失/版本不符/插件失败）不阻塞 daemon——显式
 *       卸载回 SPA 恢复夹具并记录原因（status.dsh 供 CLI/浏览器诊断）。
 *   [3] 有界停止：dispose 关闭官方 server + cordis fiber + 还原 DSH_HOME env。
 * 妥协声明：boot 是 best-effort 前台步骤（官方 profile 启动为有界等待）；降级后
 *   不自动重试——重启 daemon 是唯一恢复入口（与 4.1 的重启验证一致）。
 */
import { createHash } from "node:crypto";
import type { WebServer } from "./web-server.js";
import { bootOfficialWebProfile } from "./steward/dsh-official-profile.js";
import type { DshWebHostBootRecord, MinimalDshWebHost } from "./steward/dsh-web-host.js";

/** 缺省 home：env DSH_HOME ?? ~/.dsh（与官方 storage 解析一致）。 */
function resolveDefaultDshHome(): string {
  const env = process.env.DSH_HOME;
  if (env && env.trim() !== "") return env;
  return `${process.env.HOME ?? ""}/.dsh`;
}

/**
 * DSH 会话 cookie 名（dsh-client-connection 的 BrowserAuth 同式）：
 * `dsh-auth-<base64url(sha256(authority))>`。authority 经本 daemon 代理恒定
 * 重写为 `host:port`，故可确定性计算；DSH 端口随重启变化时 cookie 名随之
 * 变化，入口桥会重新握手（自愈）。
 */
export function dshAuthCookieName(authority: string): string {
  return `dsh-auth-${createHash("sha256").update(authority).digest("base64url")}`;
}

/** 生产 DSH 组合宿主句柄。 */
export interface ProductionDshHost {
  mounted: boolean;
  /** 未挂载原因（降级诊断；DSH 缺失/版本错误/插件失败等）。 */
  reason?: string;
  /** boot graph（entries/activationOrder/host/port/authenticatedUrl）。 */
  record?: DshWebHostBootRecord;
  /** 运行中的官方 host（mounted 时；进程内诊断/会话绑定用，不进共享契约）。 */
  profile?: MinimalDshWebHost;
  /** 有界停止：卸载挂载、关闭官方 server、还原 env。幂等。 */
  dispose(): Promise<void>;
}

export interface MountProductionDshHostOptions {
  /** DSH 存储 home（缺省用官方 profile 默认：env DSH_HOME ?? ~/.dsh）。 */
  dshHome?: string;
  /** 显式关闭（测试/逃生口；env SKILL_CREATOR_DSH_HOST=off 等效）。 */
  disabled?: boolean;
}

/**
 * boot 官方 DSH profile 并挂载到 WebServer 同源分区。任何失败都降级为 SPA
 * 恢复夹具（mountDsh(null)）并返回 mounted:false + reason——daemon 继续可用。
 */
export async function mountProductionDshHost(
  web: WebServer,
  options: MountProductionDshHostOptions = {},
): Promise<ProductionDshHost> {
  if (options.disabled || process.env.SKILL_CREATOR_DSH_HOST === "off") {
    return { mounted: false, reason: "disabled by env", dispose: async () => {} };
  }
  let profile: MinimalDshWebHost | null = null;
  try {
    profile = await bootOfficialWebProfile({
      home: options.dshHome ?? resolveDefaultDshHome(),
    });
    const server = profile.server();
    if (!server) throw new Error("official profile booted without an HTTP server");
    // 入口握手桥数据：launch token 的同源入口（path+search）与 authority 绑定的
    // 会话 cookie 名（见 dshAuthCookieName）。
    const authenticated = new URL(profile.record.authenticatedUrl);
    web.mountDsh({
      host: profile.record.host,
      port: profile.record.port,
      server,
      entryLocation: `${authenticated.pathname}${authenticated.search}`,
      authCookieName: dshAuthCookieName(`${profile.record.host}:${profile.record.port}`),
    });
    let disposed = false;
    return {
      mounted: true,
      record: profile.record,
      profile,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        web.mountDsh(null);
        await profile!.dispose();
      },
    };
  } catch (error) {
    // 降级：显式回 SPA 恢复夹具；boot 半成品（fiber 已起、server 未就绪等）同样回收。
    web.mountDsh(null);
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await profile?.dispose();
    } catch {
      // 半成品回收失败不掩盖降级主因。
    }
    return { mounted: false, reason, dispose: async () => {} };
  }
}
