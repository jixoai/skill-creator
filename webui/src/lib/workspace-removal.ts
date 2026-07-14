/**
 * 原始需求 [2026-07-14]：「我们还需要支持导入 workspace」。
 * 正交意图：确认并反馈 Remove Workspace；只移除 registry entry，不删除用户文件。
 */
import type { ImportedWorkspace } from "$lib/types";
import { showToast } from "$lib/toast.svelte";
import { removeWorkspace } from "$lib/store.svelte";

/** 确认并移除一个已导入 workspace，返回是否实际完成。 */
export async function confirmRemoveWorkspace(workspace: ImportedWorkspace): Promise<boolean> {
  if (
    !globalThis.confirm(
      `Remove ${workspace.label} from Skill Creator? Its files will stay on disk.`,
    )
  ) {
    return false;
  }

  try {
    await removeWorkspace(workspace.id);
    showToast(`Removed ${workspace.label}. Files remain on disk.`);
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
    return false;
  }
}
