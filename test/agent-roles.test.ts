// @vitest-environment node
/**
 * Roles 骑原生子代理的聚焦测试（openspec dsh-alpha-native-subagents tasks 2/3）。
 *
 * 用户裁决 [2026-09-15]：「把子代理的能力对接上来就好。」Roles = per-role 官方
 * tool-subagent 行；本套件钉住目录一致性、模式暴露矩阵、列表过滤、目录帧投影
 * 与 kernel 行 YAML 的安全不变量。
 *
 * 正交意图：
 *   [1] 目录一致性：shared 目录与 daemon persona/YAML 一一对应。
 *   [2] 模式暴露矩阵：productToolDenyList 只放行该模式的角色工具。
 *   [3] 会话面：子会话过滤 + subagent/catalog 帧投影 + 未知载荷丢弃。
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_MODE_ROLES,
  AGENT_ROLES,
  AGENT_ROLE_SLUGS,
  agentRoleToolName,
} from "../src/shared/contracts/agent-roles.js";
import { AGENT_ROLE_PERSONAS, agentRoleRowsYaml } from "../src/daemon/kernel/agent-roles.js";
import {
  productToolDenyList,
  SubagentCatalogEventSchema,
} from "../src/daemon/kernel/agent-sessions.js";

describe("agent roles catalog (task 2.1)", () => {
  it("shared catalog and daemon personas stay one-to-one", () => {
    expect(Object.keys(AGENT_ROLES).sort()).toEqual([...AGENT_ROLE_SLUGS].sort());
    expect(Object.keys(AGENT_ROLE_PERSONAS).sort()).toEqual([...AGENT_ROLE_SLUGS].sort());
  });

  it("every role declares at least one readonly capability and a non-trivial description", () => {
    for (const slug of AGENT_ROLE_SLUGS) {
      const role = AGENT_ROLES[slug];
      expect(role.capabilities.length).toBeGreaterThan(0);
      expect(role.name.length).toBeGreaterThan(0);
      expect(role.description.length).toBeGreaterThan(10);
    }
  });

  it("every mode exposes only known roles and free exposes all", () => {
    expect(AGENT_MODE_ROLES.free).toEqual([...AGENT_ROLE_SLUGS]);
    for (const mode of ["create", "manage", "explore"] as const) {
      for (const slug of AGENT_MODE_ROLES[mode]) {
        expect(AGENT_ROLE_SLUGS).toContain(slug);
      }
    }
  });
});

describe("kernel role rows yaml (task 2.3)", () => {
  const yaml = agentRoleRowsYaml();

  it("writes one official tool-subagent row per role with a unique tool name", () => {
    for (const slug of AGENT_ROLE_SLUGS) {
      expect(yaml).toContain(`- id: tool-role-${slug}`);
      expect(yaml).toContain(`toolName: ${agentRoleToolName(slug)}`);
    }
    // 唯一 toolName（官方同 fiber 冲突规避）。
    const names = [...yaml.matchAll(/toolName: (role_[a-z]+)/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses spawn provider, continuable background mode, and depth 1", () => {
    expect(yaml).toContain("provider: spawn");
    expect(yaml).toContain("backgroundMode: continuable");
    expect(yaml).not.toContain("enableRunInBackground");
    // 每个 config 块一个 maxDepth: 1。
    expect(yaml.match(/maxDepth: 1/g)?.length).toBe(AGENT_ROLE_SLUGS.length);
  });

  it("structurally denies ask_user_question in every role toolFilter", () => {
    expect(yaml.match(/- ask_user_question/g)?.length).toBe(AGENT_ROLE_SLUGS.length);
  });

  it("allow lists are exact registered mcp names (propose suffix for mutations)", () => {
    // writer 是唯一 mutation 角色：creator_save/creator_remove 只以 _propose 出现。
    expect(yaml).toContain("- mcp__skill-creator__creator_save_propose");
    expect(yaml).toContain("- mcp__skill-creator__creator_remove_propose");
    expect(yaml).not.toContain("- mcp__skill-creator__creator_save\n");
    // readonly 能力以基名注册。
    expect(yaml).toContain("- mcp__skill-creator__skills_list");
  });
});

describe("mode-aware role tool surface (task 3.1)", () => {
  const globalNames = [
    ...AGENT_ROLE_SLUGS.map(agentRoleToolName),
    "bash",
    "tool_fs_read",
    "ask_user_question",
    "mcp__skill-creator__skills_list",
  ];

  it("focused modes only allow their roles; other role tools are denied", () => {
    // explore 放 researcher/reviewer，拒 writer。
    const exploreDeny = productToolDenyList(globalNames, "explore");
    expect(exploreDeny).not.toContain("role_researcher");
    expect(exploreDeny).not.toContain("role_reviewer");
    expect(exploreDeny).toContain("role_writer");
    // create 放 reviewer/writer，拒 researcher。
    const createDeny = productToolDenyList(globalNames, "create");
    expect(createDeny).not.toContain("role_reviewer");
    expect(createDeny).toContain("role_researcher");
  });

  it("free mode allows every role plus bash while still denying generic tools", () => {
    const freeDeny = productToolDenyList(globalNames, "free");
    for (const slug of AGENT_ROLE_SLUGS) {
      expect(freeDeny).not.toContain(agentRoleToolName(slug));
    }
    expect(freeDeny).not.toContain("bash");
    expect(freeDeny).toContain("tool_fs_read");
    expect(freeDeny).not.toContain("mcp__skill-creator__skills_list");
  });
});

describe("subagent session surface (tasks 3.2/3.3)", () => {
  it("projects a valid subagent/catalog payload frame payload shape", () => {
    const checked = SubagentCatalogEventSchema.safeParse({
      childId: "sess-child-1",
      childCreatedAt: 1_700_000_000_000,
      mode: "continuable",
      label: "review library",
    });
    expect(checked.success).toBe(true);
    if (checked.success) {
      expect(checked.data.childId).toBe("sess-child-1");
      expect(checked.data.mode).toBe("continuable");
    }
  });

  it("drops malformed catalog payloads at the schema gate", () => {
    expect(SubagentCatalogEventSchema.safeParse({ mode: "continuable" }).success).toBe(false);
    expect(SubagentCatalogEventSchema.safeParse("nope").success).toBe(false);
    expect(SubagentCatalogEventSchema.safeParse({ childId: "c", mode: "strange" }).success).toBe(
      false,
    );
  });

  it("one-shot catalog entries may omit the label", () => {
    const checked = SubagentCatalogEventSchema.safeParse({
      childId: "c2",
      mode: "one-shot",
    });
    expect(checked.success).toBe(true);
  });
});
