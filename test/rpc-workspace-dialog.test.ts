/**
 * workspace.pickDirectory RPC 面测试（ext-dialog 集成，2026-09-19）。
 *
 * User input [2026-09-19]: "@opentray/ext-dialog 原生支持了文件选择器，你可以试用一下"
 * Orthogonal intents:
 *   [1] 契约三态经真实 router + domain 投影（选中路径 / 取消 null / 不支持）。
 *   [2] typed UNAVAILABLE 不被错误边界吞掉为未知形状。
 */
import { ORPCError, createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import type { DialogService } from "../src/daemon/dialog-service.js";
import { DomainError } from "../src/daemon/domain-error.js";

function domainWith(dialog: Pick<DialogService, "pickDirectory">): DaemonDomain {
  const domain = createDaemonDomain(undefined, {});
  return { ...domain, dialog } as DaemonDomain;
}

function clientFor(dialog: Pick<DialogService, "pickDirectory">) {
  return createRouterClient(
    createRpcRouter({
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "mounted",
      }),
      domain: domainWith(dialog),
    }),
  );
}

describe("workspace.pickDirectory RPC surface", () => {
  it("projects a picked path through the router", async () => {
    const client = clientFor({ pickDirectory: async () => ({ supported: true, path: "/tmp/ws" }) });
    await expect(client.workspace.pickDirectory({})).resolves.toEqual({
      supported: true,
      path: "/tmp/ws",
    });
  });

  it("projects user cancel as supported:true with null path", async () => {
    const client = clientFor({ pickDirectory: async () => ({ supported: true, path: null }) });
    await expect(client.workspace.pickDirectory({})).resolves.toEqual({
      supported: true,
      path: null,
    });
  });

  it("projects headless/unsupported platforms as supported:false", async () => {
    const client = clientFor({
      pickDirectory: async () => ({ supported: false, path: null }),
    });
    await expect(client.workspace.pickDirectory({})).resolves.toEqual({
      supported: false,
      path: null,
    });
  });

  it("surfaces typed UNAVAILABLE through the error boundary", async () => {
    const client = clientFor({
      pickDirectory: async () => {
        throw new DomainError("UNAVAILABLE", "picker bridge failed");
      },
    });
    const failure = client.workspace.pickDirectory({});
    await expect(failure).rejects.toBeInstanceOf(ORPCError);
    await expect(failure).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
