/**
 * 原始需求 [2026-07-14]：「我们还需要一个 `/repository/`，来支持远程仓库预览 skills 并安装 它们」。
 * 正交意图：
 * 1. 按最新请求代次投影固定 commit 的仓库扫描与技能预览。
 * 2. 按连接所有权与最新请求代次管理安装操作状态。
 */
import type {
  ImportedWorkspaceId,
  InstallResult,
  RemoteRepoScan,
  RemoteSkillId,
  RemoteSkillPreview,
} from "../types";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

const scanRequests = createRequestGenerationGate(getConnectionGeneration);
const previewRequests = createRequestGenerationGate(getConnectionGeneration);
const installRequests = createRequestGenerationGate(getConnectionGeneration);

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
  const request = scanRequests.issue();
  previewRequests.invalidate();
  installRequests.invalidate();
  repositoryState.scanning = true;
  repositoryState.previewing = false;
  repositoryState.installing = false;
  repositoryState.scan = null;
  repositoryState.preview = null;
  repositoryState.error = null;
  try {
    const scan = await requireRpc().repository.scan({ source, ref });
    if (request.isCurrent()) repositoryState.scan = scan;
  } catch (error) {
    if (!request.isCurrent()) return;
    repositoryState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) repositoryState.scanning = false;
  }
}

/** 从当前固定会话加载一个技能预览。 */
export async function previewRemoteSkill(skillId: RemoteSkillId): Promise<void> {
  const scan = repositoryState.scan;
  if (!scan) throw new Error("Scan a repository first.");
  const request = previewRequests.issue();
  const canCommit = (): boolean =>
    request.isCurrent() && repositoryState.scan?.sessionId === scan.sessionId;
  repositoryState.previewing = true;
  repositoryState.preview = null;
  repositoryState.error = null;
  try {
    const preview = await requireRpc().repository.preview({
      sessionId: scan.sessionId,
      skillId,
    });
    if (canCommit()) repositoryState.preview = preview;
  } catch (error) {
    if (!canCommit()) return;
    repositoryState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) repositoryState.previewing = false;
  }
}

/** 将当前固定会话中的技能安装或 dry-run 到显式 workspace。 */
export async function installRemoteSkills(input: {
  skillIds: RemoteSkillId[];
  workspaceId: ImportedWorkspaceId;
  force?: boolean;
  dryRun?: boolean;
}): Promise<InstallResult | null> {
  const scan = repositoryState.scan;
  if (!scan) throw new Error("Repository session expired. Scan again.");
  const request = installRequests.issue();
  const canCommit = (): boolean =>
    request.isCurrent() && repositoryState.scan?.sessionId === scan.sessionId;
  repositoryState.installing = true;
  repositoryState.error = null;
  try {
    const result = await requireRpc().repository.install({
      sessionId: scan.sessionId,
      ...input,
    });
    return canCommit() ? result : null;
  } catch (error) {
    if (!canCommit()) return null;
    throw error;
  } finally {
    if (request.isLatest()) repositoryState.installing = false;
  }
}
