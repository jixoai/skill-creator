/**
 * 用户原始需求 [2026-09-19]：「@opentray/ext-dialog 原生支持了文件选择器，你可以
 * 试用一下」（0.32.0 osascript 桥修复 jixoai/opentray#10 后集成）。
 * 正交意图：
 *   [1] 持有 ext-dialog 的 session-scoped capability（tray 挂载成功后 attach；
 *       headless / tray 失败时保持未挂载——pick 投影为不支持，不炸）。
 *   [2] pickDirectory 的领域投影：platform 不支持 / 未挂载 → supported:false
 *       （WebUI 隐藏入口）；用户取消 → path:null；桥接失败 → typed UNAVAILABLE。
 * 妥协声明：attachDialog 需要 tray handle（host-side 能力，无页面桥）——RPC 消费方
 * 经 daemon 中转；Linux 无原生实现（typed platform_unsupported → supported:false）。
 */
import type { TrayHandle } from "opentray";
import { DomainError } from "./domain-error.js";

/** pickDirectory 的稳定投影（WebUI 以 supported 决定 Browse 入口显隐）。 */
export interface DialogPickResult {
  supported: boolean;
  path: string | null;
}

/** 原生对话框能力的最小面。 */
export interface NativeDirectoryPicker {
  pickDirectory(): Promise<string | null>;
}

/** ext-dialog 的 attach 面（测试可注入 stub）。 */
export type DialogAttacher = (tray: TrayHandle) => NativeDirectoryPicker;

/** daemon 生命周期内的对话框服务；tray 挂载后 attach 才可用。 */
export interface DialogService {
  attach(tray: TrayHandle): void;
  pickDirectory(): Promise<DialogPickResult>;
}

/** 动态加载 @opentray/ext-dialog 并 attach（真实现；测试注入 stub）。 */
async function attachExtDialog(tray: TrayHandle): Promise<NativeDirectoryPicker> {
  const ext = await import("@opentray/ext-dialog");
  return ext.attachDialog(tray);
}

export function createDialogService(
  options: { attachDialog?: DialogAttacher } = {},
): DialogService {
  const attachDialog = options.attachDialog ?? attachExtDialog;
  let picker: NativeDirectoryPicker | null = null;
  return {
    attach(tray) {
      if (picker !== null) return;
      // 动态 import：headless/无消费场景不加载 native 扩展包；attach 的同步
      // 异常与加载失败都保持不支持（绝不炸 tray 挂载流程）。tray 销毁随
      // daemon 停止整体回收（session-scoped）。
      try {
        void Promise.resolve(attachDialog(tray))
          .then((attached) => {
            picker = attached;
          })
          .catch(() => undefined);
      } catch {
        // 同步 throw 的 attacher（非法注入/加载失败）→ 保持未挂载。
      }
    },
    async pickDirectory() {
      if (picker === null) return { supported: false, path: null };
      try {
        return { supported: true, path: await picker.pickDirectory() };
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === "dialog_platform_unsupported") {
          return { supported: false, path: null };
        }
        throw new DomainError(
          "UNAVAILABLE",
          "The native directory picker could not be presented.",
          { cause: error },
        );
      }
    },
  };
}
