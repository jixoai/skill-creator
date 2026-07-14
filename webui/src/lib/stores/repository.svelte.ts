/**
 * 原始需求 [2026-07-14]：「我们还需要一个 `/repository/`，来支持远程仓库预览 skills 并安装 它们」。
 * 正交意图：
 * 1. 投影固定 commit 的仓库扫描会话。
 * 2. 管理技能预览与安装操作状态。
 */
import type { InstallResult, RemoteRepoScan, RemoteSkillPreview } from "../types";
import { requireRpc } from "./connection.svelte";

/** Repository 页面共享的扫描、预览与安装状态。 */
export const repositoryState = $state<{
  scan: RemoteRepoScan | null;
  preview: RemoteSkillPreview | null;
  scanning: boolean;
  previewing: boolean;
  installing: boolean;
  error: string | null;
}>({
  scan: null,
  preview: null,
  scanning: false,
  previewing: false,
  installing: false,
  error: null,
});

/** 扫描远程仓库并固定返回的 commit 会话。 */
export async function scanRemoteRepo(source: string, ref?: string): Promise<void> {
  repositoryState.scanning = true;
  repositoryState.scan = null;
  repositoryState.preview = null;
  repositoryState.error = null;
  try {
    repositoryState.scan = await requireRpc().repository.scan({ source, ref });
  } catch (error) {
    repositoryState.error = error instanceof Error ? error.message : String(error);
  } finally {
    repositoryState.scanning = false;
  }
}

/** 从当前固定会话加载一个技能预览。 */
export async function previewRemoteSkill(skillId: string): Promise<void> {
  if (!repositoryState.scan) throw new Error("Scan a repository first.");
  repositoryState.previewing = true;
  repositoryState.preview = null;
  repositoryState.error = null;
  try {
    repositoryState.preview = await requireRpc().repository.preview({
      sessionId: repositoryState.scan.sessionId,
      skillId,
    });
  } catch (error) {
    repositoryState.error = error instanceof Error ? error.message : String(error);
  } finally {
    repositoryState.previewing = false;
  }
}

/** 将当前固定会话中的技能安装或 dry-run 到显式 workspace。 */
export async function installRemoteSkills(input: {
  skillIds: string[];
  workspaceId: string;
  force?: boolean;
  dryRun?: boolean;
}): Promise<InstallResult> {
  if (!repositoryState.scan) throw new Error("Repository session expired. Scan again.");
  repositoryState.installing = true;
  try {
    return await requireRpc().repository.install({
      sessionId: repositoryState.scan.sessionId,
      ...input,
    });
  } finally {
    repositoryState.installing = false;
  }
}
