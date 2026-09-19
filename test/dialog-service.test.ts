/**
 * 原生目录选择器服务测试（ext-dialog 集成，2026-09-19）。
 *
 * User input [2026-09-19]: "@opentray/ext-dialog 原生支持了文件选择器，你可以试用一下"
 * Orthogonal intents:
 *   [1] attach 前的 pickDirectory 投影为不支持（headless / tray 失败不炸）。
 *   [2] 平台 typed 拒绝（dialog_platform_unsupported）→ supported:false。
 *   [3] 用户取消 → path:null；其他桥接失败 → typed UNAVAILABLE。
 * （attach 真包路径 + 真机点击链路由 dev 走查覆盖；此处只测领域投影。）
 */
import { describe, expect, it } from "vitest";
import type { TrayHandle } from "opentray";
import { createDialogService, type NativeDirectoryPicker } from "../src/daemon/dialog-service.js";
import { DomainError } from "../src/daemon/domain-error.js";

/** attach 桩（attach 内部是 microtask 链——flush 后 picker 就位）。 */
async function serviceWith(
  picker: NativeDirectoryPicker | null,
): Promise<ReturnType<typeof createDialogService>> {
  if (picker === null) return createDialogService();
  const service = createDialogService({
    attachDialog: () => picker,
  });
  service.attach({} as TrayHandle);
  await Promise.resolve(); // flush attach 的 then 链
  await Promise.resolve();
  return service;
}

function throwingPicker(code: string): NativeDirectoryPicker {
  return {
    pickDirectory: () => {
      throw Object.assign(new Error(`${code} failure`), { code });
    },
  };
}

describe("dialog service (ext-dialog integration)", () => {
  it("projects unsupported before a tray is attached (headless)", async () => {
    const service = createDialogService();
    await expect(service.pickDirectory()).resolves.toEqual({
      supported: false,
      path: null,
    });
  });

  it("returns the picked path after attach", async () => {
    const service = await serviceWith({ pickDirectory: async () => "/tmp/chosen" });
    await expect(service.pickDirectory()).resolves.toEqual({
      supported: true,
      path: "/tmp/chosen",
    });
  });

  it("maps user cancel to supported:true with a null path", async () => {
    const service = await serviceWith({ pickDirectory: async () => null });
    await expect(service.pickDirectory()).resolves.toEqual({
      supported: true,
      path: null,
    });
  });

  it("maps typed platform-unsupported to supported:false", async () => {
    const service = await serviceWith(throwingPicker("dialog_platform_unsupported"));
    await expect(service.pickDirectory()).resolves.toEqual({
      supported: false,
      path: null,
    });
  });

  it("surfaces other picker failures as typed UNAVAILABLE", async () => {
    const service = await serviceWith(throwingPicker("dialog_worker_limit_reached"));
    const failure = service.pickDirectory();
    await expect(failure).rejects.toBeInstanceOf(DomainError);
    await expect(failure).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("keeps the unsupported projection when attach fails to load the extension", async () => {
    const service = createDialogService({
      attachDialog: () => {
        throw new Error("extension load failed");
      },
    });
    service.attach({} as TrayHandle);
    await Promise.resolve();
    await expect(service.pickDirectory()).resolves.toEqual({
      supported: false,
      path: null,
    });
  });
});
