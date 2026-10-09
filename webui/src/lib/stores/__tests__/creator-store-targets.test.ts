/**
 * creator-store-targets 纯推导测试（creator-skill-store 批 2）。
 *
 * 用户原始需求 [2026-10-09]（proposal）：「……安装到本地 agent skills 目录（包括
 * .agents/skills .codex/skills 等）……比方说……直接把技能放在 .agents/skills
 * 目录，这属于我们可以自动化做到事情。」
 *
 * 正交意图：
 *   [1] root 去重钉：catalog 中共享同一物理 root 的 provider（如 cline/dexto →
 *       ~/.agents/skills）归并为一组，代表 target 确定性（开放标准成员优先）。
 *   [2] 默认勾选钉：global 面唯一 defaultChecked 组 = globalPath `.agents/skills`
 *       的开放标准组；project 面永不默认勾选。
 *   [3] 应用面投影钉：appliedScopeRows 把 status 的 appliedRoots 按 scope 归组，
 *       workspace label 就地解析（未知 ws 回退 id，不伪造）。
 */
import { describe, expect, it } from "vitest";
import { appliedScopeRows, storeApplyTargets } from "../creator-store-targets";
import type { Workspace, WorkspaceProvider } from "../../types";
import { ProviderIdSchema, type ImportedWorkspaceId } from "$shared/contracts/workspaces.js";

const HOME = "/home/tester";
const WS_ID = "ws_0123456789abcdef01234567" as ImportedWorkspaceId;

/** branded ProviderId 的 provider fixture 构造（数组序即投影序）。 */
function provider(id: string, path: string | null, writable = false): WorkspaceProvider {
  return {
    id: ProviderIdSchema.parse(id),
    label: id,
    path,
    available: path !== null,
    writable,
    skillCount: 0,
  };
}

function workspacesFixture(): Workspace[] {
  return [
    {
      id: "~",
      kind: "global",
      label: "Global Workspace",
      path: null,
      active: true,
      available: true,
      skillCount: 0,
      providers: [
        // dexto/cline 共享 ~/.agents/skills（开放标准组，globalPath 全为
        // `.agents/skills`）；codex 独立 root；eve 无 globalPath（不入选）。
        provider("dexto", `${HOME}/.agents/skills`),
        provider("eve", null),
        provider("cline", `${HOME}/.agents/skills`),
        provider("codex", `${HOME}/.codex/skills`),
      ],
    },
    {
      id: WS_ID,
      kind: "directory",
      path: "/tmp/lab",
      label: "Lab",
      active: false,
      available: true,
      skillCount: 0,
      providers: [
        // zed/cursor 共享 ws 内 .agents/skills（去重为一组）；openclaw 独立 root。
        provider("zed", "/tmp/lab/.agents/skills", true),
        provider("cursor", "/tmp/lab/.agents/skills", true),
        provider("openclaw", "/tmp/lab/skills", true),
      ],
    },
  ];
}

describe("storeApplyTargets", () => {
  it("dedupes providers by resolved root and marks only the open-standard group default-checked", () => {
    const targets = storeApplyTargets(workspacesFixture());

    // root 去重：cline/dexto 与 cursor/zed 各归并一组 → 4 组（2 global + 2 project）。
    expect(targets.map((entry) => entry.root)).toEqual([
      `${HOME}/.agents/skills`,
      `${HOME}/.codex/skills`,
      "/tmp/lab/.agents/skills",
      "/tmp/lab/skills",
    ]);
    // 开放标准组置顶且唯一 defaultChecked；代表 = 组内首个成员（dexto，投影序
    // 确定——该组成员的 globalPath 全为 `.agents/skills`，任一代表同根）。
    expect(targets[0]).toMatchObject({
      scope: "global",
      defaultChecked: true,
      target: { workspaceId: "~", providerId: "dexto" },
    });
    expect(targets.filter((entry) => entry.defaultChecked)).toHaveLength(1);
    // project 面永不默认勾选。
    for (const entry of targets.filter((item) => item.scope === "project")) {
      expect(entry.defaultChecked).toBe(false);
    }
    // workspace label 就地携带（分区头展示）。
    expect(targets[2]?.workspaceLabel).toBe("Lab");
  });

  it("picks the first member deterministically for non-open-standard shared roots", () => {
    // amp 与 replit 共享 XDG root（.config/agents/skills）：非开放标准组——代表 =
    // 投影序首个成员，且不默认勾选。
    const global: Workspace = {
      id: "~",
      kind: "global",
      label: "Global Workspace",
      path: null,
      active: true,
      available: true,
      skillCount: 0,
      providers: [
        provider("replit", "/home/tester/.config/agents/skills"),
        provider("amp", "/home/tester/.config/agents/skills"),
      ],
    };
    const targets = storeApplyTargets([global]);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      root: "/home/tester/.config/agents/skills",
      defaultChecked: false,
      target: { workspaceId: "~", providerId: "replit" },
    });
  });
});

describe("appliedScopeRows", () => {
  it("groups applied roots by scope and resolves workspace labels without fabricating", () => {
    const rows = appliedScopeRows(
      [
        { scope: "global", roots: [`${HOME}/.agents/skills`, `${HOME}/.codex/skills`] },
        { scope: "project", workspaceId: WS_ID, roots: ["/tmp/lab/.agents/skills"] },
        { scope: "project", workspaceId: "ws_ffffffffffffffffffffffff", roots: ["/x"] },
      ],
      workspacesFixture(),
    );
    expect(rows).toEqual([
      {
        scope: "global",
        label: "Global",
        roots: [`${HOME}/.agents/skills`, `${HOME}/.codex/skills`],
      },
      { scope: "project", workspaceId: WS_ID, label: "Lab", roots: ["/tmp/lab/.agents/skills"] },
      // 未知 ws：回退 opaque id（不伪造 label）。
      {
        scope: "project",
        workspaceId: "ws_ffffffffffffffffffffffff",
        label: "ws_ffffffffffffffffffffffff",
        roots: ["/x"],
      },
    ]);
  });
});
