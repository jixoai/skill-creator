/**
 * 用户原始需求 [2026-10-09]（creator-skill-store 批 2 / proposal）：「然后再通过
 * ccski-sdk 将这些 skill 安装到本地 agent skills 目录（包括 .agents/skills
 * .codex/skills 等）……比方说……直接把技能放在 .agents/skills 目录，这属于
 * 我们可以自动化做到事情。」
 * 正交意图：
 *   [1] 纯函数派生 store 技能的应用目标全集：Global agent roots + Imported
 *       workspace providers（任何 ws 上下文同构——store 无 ws 归属）。
 *   [2] 按已解析根目录去重：catalog 中大量 provider 共享同一物理 root
 *       （如 `.agents/skills`），每组取一个代表 target（daemon 端按 root 归一，
 *       代表 id 不影响落点）；组标签 = root 路径（与 apply 收据同币）。
 *   [3] 开放标准组识别（globalPath === ".agents/skills"）→ 默认勾选位
 *       （auto-apply 同位；Owner：「直接放在 .agents/skills 属于可自动化」）。
 * 妥协声明：无。响应态（workspaceState）由调用方持有，本模块只做投影。
 */
import { providerCatalogEntry } from "$shared/provider-catalog.js";
import type { Workspace, WorkspaceProviderTarget } from "../types";

/** 开放标准 agent root 的 catalog globalPath（= 内核 global 实体库根）。 */
const OPEN_STANDARD_GLOBAL_PATH = ".agents/skills";

/** 一个可选的应用目标（去重后的 root 组）。 */
export interface StoreApplyTarget {
  /** 代表 provider target（daemon 解析为投影根；不收调用方路径）。 */
  target: WorkspaceProviderTarget;
  /** 组的已解析根目录（分组键 = 显示真相，与 apply 收据 root 同币）。 */
  root: string;
  /** global（home agent root）| project（Imported workspace 内 provider root）。 */
  scope: "global" | "project";
  /** 归属 workspace 的展示 label。 */
  workspaceLabel: string;
  /** 开放标准组（global `.agents/skills`）→ 默认勾选。 */
  defaultChecked: boolean;
}

interface TargetGroup {
  root: string;
  scope: "global" | "project";
  workspaceLabel: string;
  workspaceId: WorkspaceProviderTarget["workspaceId"];
  /** 组内首个成员（代表 target 的 providerId——投影序确定）。 */
  firstProviderId: string;
  /** 任一成员的 catalog globalPath === `.agents/skills`（global 面）→ 默认勾选。 */
  openStandard: boolean;
}

function collectGroups(
  workspaceId: WorkspaceProviderTarget["workspaceId"],
  workspaceLabel: string,
  scope: "global" | "project",
  providers: readonly { id: string; path: string | null; writable: boolean }[],
): Array<TargetGroup & { representative: WorkspaceProviderTarget }> {
  const groups = new Map<string, TargetGroup>();
  for (const provider of providers) {
    if (provider.path === null) continue;
    if (scope === "project" && !provider.writable) continue;
    const catalog = providerCatalogEntry(provider.id);
    if (catalog === undefined) continue;
    const openStandardMember =
      scope === "global" && catalog.globalPath === OPEN_STANDARD_GLOBAL_PATH;
    let group = groups.get(provider.path);
    if (group === undefined) {
      groups.set(provider.path, {
        root: provider.path,
        scope,
        workspaceLabel,
        workspaceId,
        firstProviderId: provider.id,
        openStandard: openStandardMember,
      });
      continue;
    }
    if (openStandardMember) group.openStandard = true;
  }
  // 共享 `~/.agents/skills` root 的成员其 globalPath 必为 `.agents/skills`（该
  // root 无 env override）——组内首个成员即确定性代表，无需偏好位。
  return [...groups.values()].map((group) => ({
    ...group,
    representative: {
      workspaceId: group.workspaceId,
      providerId: group.firstProviderId as WorkspaceProviderTarget["providerId"],
    },
  }));
}

/**
 * 派生 store 技能的应用目标全集：Global agent roots 在前（开放标准组随后置顶
 * 不改变组内序），其后按投影序每个 Imported workspace 的去重 provider roots。
 */
export function storeApplyTargets(workspaces: readonly Workspace[]): StoreApplyTarget[] {
  const groups: Array<TargetGroup & { representative: WorkspaceProviderTarget }> = [];
  for (const workspace of workspaces) {
    if (workspace.kind === "global") {
      groups.push(...collectGroups(workspace.id, workspace.label, "global", workspace.providers));
    } else if (workspace.available) {
      groups.push(...collectGroups(workspace.id, workspace.label, "project", workspace.providers));
    }
  }
  const projected: StoreApplyTarget[] = groups.map((group) => ({
    target: group.representative,
    root: group.root,
    scope: group.scope,
    workspaceLabel: group.workspaceLabel,
    defaultChecked: group.openStandard,
  }));
  // 开放标准组置顶（默认勾选项应最先可见；其余保持推导序）。
  return projected.sort(
    (left, right) => Number(right.defaultChecked) - Number(left.defaultChecked),
  );
}

/** 应用面（CreatorStoreApplication）的展示行：scope 归组 + roots 逐行列出。 */
export interface AppliedScopeRow {
  scope: "global" | "project";
  workspaceId?: string;
  label: string;
  roots: string[];
}

/** 把 status 的 appliedRoots 投影为逐 scope 展示行（workspace label 就地解析）。 */
export function appliedScopeRows(
  applications: readonly {
    scope: "global" | "project";
    workspaceId?: string;
    roots: string[];
  }[],
  workspaces: readonly Workspace[],
): AppliedScopeRow[] {
  return applications.map((application) => {
    const workspace =
      application.workspaceId !== undefined
        ? workspaces.find((item) => item.id === application.workspaceId)
        : undefined;
    return {
      scope: application.scope,
      ...(application.workspaceId !== undefined ? { workspaceId: application.workspaceId } : {}),
      label: workspace?.label ?? application.workspaceId ?? "Global",
      roots: [...application.roots],
    };
  });
}
