/**
 * Agent 模式注册表单测（openspec add-agent-settings-modes task 4.1）。
 *
 * 用户原始需求 [2026-09-08]：「我们需要提供 创作模式 、 管理模式 、 探索模式 、
 * 自由模式……前面 3 种专有模式毕竟是把 skill 灌成系统提示词。」
 *
 * 正交意图：
 *   [1] 目录单一事实源：DSH_AGENT_MODES 与 daemon 注册表一一对应（无第二份手抄）。
 *   [2] 工具面矩阵：专有模式按名单放行 MCP 工具（propose 变体随基名继承）；
 *       free 全放行；非 MCP 工具不归模式管。
 *   [3] setup 注入：专有模式注册 section + guard；free 无专有 section。
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_MODES,
  agentModeGuardReason,
  agentModeSectionName,
  applyAgentMode,
  mcpToolAllowedInMode,
} from "../src/daemon/kernel/agent-modes.js";
import { productToolDenyList } from "../src/daemon/kernel/agent-sessions.js";
import { DSH_AGENT_MODES, type DshAgentMode } from "../src/shared/contracts/dsh-runtime.js";

describe("agent mode catalog consistency", () => {
  it("catalog ids match the daemon registry one-to-one", () => {
    expect(DSH_AGENT_MODES.map((entry) => entry.id)).toEqual(Object.keys(AGENT_MODES));
  });

  it("free/General is the default entry: light section, full tool surface", () => {
    // 通用模式（2026-09-11 用户裁决）：轻量入口提示词（只列专注模式），无工具收窄。
    expect(AGENT_MODES.free.tools).toBeNull();
    expect(AGENT_MODES.free.sectionText).toBeTruthy();
    expect(AGENT_MODES.free.sectionText).toContain("Create");
    expect(DSH_AGENT_MODES.find((entry) => entry.id === "free")).toMatchObject({
      label: "General",
    });
    for (const mode of ["create", "manage", "explore"] as const) {
      expect(AGENT_MODES[mode].sectionText).toBeTruthy();
      expect(AGENT_MODES[mode].tools!.length).toBeGreaterThan(0);
    }
  });

  it("every focused mode allows the skills_search tool (skill-search-integration C3)", () => {
    // 「任何模式都能检索本地技能」：capability skills.search 投影基名 skills_search。
    for (const mode of ["create", "manage", "explore"] as const) {
      expect(AGENT_MODES[mode].tools).toContain("skills_search");
      expect(mcpToolAllowedInMode(mode, "mcp__skill-creator__skills_search")).toBe(true);
    }
    // free 前缀全放行，不进名单。
    expect(AGENT_MODES.free.tools).toBeNull();
    expect(mcpToolAllowedInMode("free", "mcp__skill-creator__skills_search")).toBe(true);
  });
});

describe("productToolDenyList native tool policy", () => {
  const globalNames = ["ask_user_question", "bash", "read_file", "list_directory", "web_search"];

  it("focused modes deny the native bash tool", () => {
    for (const mode of ["create", "manage", "explore"] as const) {
      const deny = productToolDenyList(globalNames, mode);
      expect(deny).toContain("bash");
      expect(deny).not.toContain("ask_user_question");
      expect(deny).toContain("read_file");
      expect(deny).toContain("web_search");
    }
  });

  it("open (free) mode allows bash and still denies other native tools", () => {
    const deny = productToolDenyList(globalNames, "free");
    expect(deny).not.toContain("bash");
    expect(deny).not.toContain("ask_user_question");
    expect(deny).toContain("read_file");
    expect(deny).toContain("web_search");
  });
});

describe("mcpToolAllowedInMode matrix", () => {
  it("create mode allows creator tools and denies repository/manage tools", () => {
    expect(mcpToolAllowedInMode("create", "mcp__skill-creator__creator_save")).toBe(true);
    expect(mcpToolAllowedInMode("create", "mcp__skill-creator__creator_save_propose")).toBe(true);
    expect(mcpToolAllowedInMode("create", "mcp__skill-creator__repository_scan")).toBe(false);
    expect(mcpToolAllowedInMode("create", "mcp__skill-creator__skills_toggle")).toBe(false);
  });

  it("explore mode allows the repository face and denies creator writes", () => {
    expect(mcpToolAllowedInMode("explore", "mcp__skill-creator__repository_scan")).toBe(true);
    expect(mcpToolAllowedInMode("explore", "mcp__skill-creator__repository_install")).toBe(true);
    expect(mcpToolAllowedInMode("explore", "mcp__skill-creator__creator_save")).toBe(false);
  });

  it("free mode allows every skill-creator tool; non-MCP tools are mode-agnostic", () => {
    expect(mcpToolAllowedInMode("free", "mcp__skill-creator__anything")).toBe(true);
    expect(mcpToolAllowedInMode("create", "ask_user_question")).toBe(true);
    expect(mcpToolAllowedInMode("explore", "some_other_tool")).toBe(true);
  });

  it("guard reason names the tool and the mode switch path", () => {
    const reason = agentModeGuardReason("create", "mcp__skill-creator__repository_scan");
    expect(reason).toContain("repository_scan");
    expect(reason).toContain("create");
    expect(agentModeGuardReason("free", "mcp__skill-creator__repository_scan")).toBeUndefined();
  });
});

describe("applyAgentMode setup injection", () => {
  interface Captured {
    sections: Array<{ name: string; order: number; text: string }>;
    guards: Array<(exec: { name?: string }) => string | undefined>;
  }

  function fakeCtx(): { ctx: unknown; captured: Captured } {
    const captured: Captured = { sections: [], guards: [] };
    const ctx = {
      systemPrompt: { section: (section: unknown) => captured.sections.push(section as never) },
      tools: { guard: (guard: never) => captured.guards.push(guard) },
    };
    return { ctx, captured };
  }

  it("registers the mode section and a working guard for focused modes", () => {
    const { ctx, captured } = fakeCtx();
    applyAgentMode(ctx as never, "manage");
    expect(captured.sections).toHaveLength(1);
    expect(captured.sections[0]).toMatchObject({
      name: agentModeSectionName("manage"),
      order: 40,
    });
    expect(captured.guards).toHaveLength(1);
    const guard = captured.guards[0]!;
    expect(guard({ name: "mcp__skill-creator__skills_toggle" })).toBeUndefined();
    expect(guard({ name: "mcp__skill-creator__repository_scan" })).toContain("manage");
  });

  it("free/General registers its light entry section plus the permissive guard", () => {
    const { ctx, captured } = fakeCtx();
    applyAgentMode(ctx as never, "free");
    expect(captured.sections).toHaveLength(1);
    expect(captured.sections[0]).toMatchObject({ name: "skill-creator-mode-free", order: 40 });
    expect(captured.guards).toHaveLength(1);
    const guard = captured.guards[0]!;
    expect(guard({ name: "mcp__skill-creator__repository_scan" })).toBeUndefined();
  });

  it("every catalog mode survives setup injection without throwing", () => {
    for (const entry of DSH_AGENT_MODES) {
      const { ctx } = fakeCtx();
      expect(() => applyAgentMode(ctx as never, entry.id as DshAgentMode)).not.toThrow();
    }
  });
});
