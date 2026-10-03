/**
 * Creator 会话面纯逻辑测试（creator-agent-chat 1.1/1.2/1.4/1.5）。
 *
 * 用户原始需求 [2026-10-03]（design §1/§2/§5 + specs/creator）：
 * 「会话列表仅显示 ws_a 且 seedSkill 非空」「同技能命中即续聊 / 不续上他技能
 * 的对话」「seed 结构化 prompt 逐字断言（沿 transcript meta seed 既有机制）」
 * 「契约面无 context.skillId 平行字段（schema 无此键断言）」。
 *
 * 正交意图：
 *   [1] 过滤与查找键：creator 会话 = target=ws + seedSkill 非空；技能维度
 *       续聊 = target（ws+provider）+ seedSkill 精确匹配（两态 Scenario）。
 *   [2] seed 冻结：结构化 prompt 逐字（循环措辞 + creator_save_propose 提案链
 *       指令）；技能聊天引言携带 `$name` token（芯片配对前提）。
 *   [3] 护栏投影：话术建议编号行解析；creator_save_propose 工具帧 → 草稿卡
 *       （args safeParse + proposalId 深扫）。
 *   [4] 契约钉死：AgentSessionSummarySchema 无平行 context 字段。
 */
import { describe, expect, it } from "vitest";
import { AgentSessionSummarySchema } from "$shared/contracts/agent.js";
import type { AgentSessionSummary } from "$shared/contracts/agent.js";
import type { SkillId } from "$shared/contracts/skills.js";
import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";
import type { PanelItem } from "$lib/stores/agent.svelte";
import {
  CREATOR_LOOP_STAGES,
  buildCreatorSeedPrompt,
  buildSkillChatIntro,
  buildTestSuggestionPrompt,
  creatorSessionsForWorkspace,
  draftCardsFromItems,
  findSkillChatSession,
  isCreatorSaveProposeTool,
  parseTestSuggestions,
} from "../creator-sessions.js";

const WS_A = "ws_aaaaaaaaaaaaaaaaaaaaaaaa" as WorkspaceId;
const WS_B = "ws_bbbbbbbbbbbbbbbbbbbbbbbb" as WorkspaceId;
const PROVIDER = "zcode" as ProviderId;
const SK_BASH = `sk_${"b".repeat(24)}` as SkillId;
const SK_VUE = `sk_${"c".repeat(24)}` as SkillId;
const SK_OTHER = `sk_${"d".repeat(24)}` as SkillId;

function session(input: {
  sessionId: string;
  workspaceId?: string;
  providerId?: string;
  seedSkill?: SkillId | null;
  createdAt?: string;
}): AgentSessionSummary {
  return {
    sessionId: input.sessionId,
    title: input.sessionId,
    status: "idle",
    cwd: "/tmp",
    createdAt: input.createdAt ?? "2026-10-03T00:00:00.000Z",
    mode: "free",
    ...(input.workspaceId !== undefined
      ? {
          target: {
            workspaceId: input.workspaceId as WorkspaceId,
            ...(input.providerId !== undefined
              ? { providerId: input.providerId as ProviderId }
              : {}),
          },
        }
      : {}),
    seedSkill: input.seedSkill === undefined ? null : input.seedSkill,
  };
}

describe("creatorSessionsForWorkspace (specs/creator「会话列表按 summary 过滤」)", () => {
  it("shows only ws sessions with a non-null seedSkill — spec scenario", () => {
    const sessions = [
      session({ sessionId: "s1", workspaceId: WS_A, providerId: "zcode", seedSkill: SK_BASH }),
      session({ sessionId: "s2", workspaceId: WS_A, seedSkill: SK_VUE }),
      session({ sessionId: "s3", workspaceId: WS_A, seedSkill: null }),
      session({ sessionId: "s4", workspaceId: WS_B, seedSkill: SK_OTHER }),
      session({ sessionId: "s5", seedSkill: SK_BASH }),
    ];
    const listed = creatorSessionsForWorkspace(sessions, WS_A);
    // Scenario：3 个 ws_a 会话（2 带种子 1 无）+ 2 个他 ws/无归属 → 仅 2。
    expect(listed.map((item) => item.sessionId)).toEqual(["s1", "s2"]);
  });

  it("orders by createdAt descending (recent first)", () => {
    const listed = creatorSessionsForWorkspace(
      [
        session({
          sessionId: "old",
          workspaceId: WS_A,
          seedSkill: SK_BASH,
          createdAt: "2026-10-01T00:00:00.000Z",
        }),
        session({
          sessionId: "new",
          workspaceId: WS_A,
          seedSkill: SK_BASH,
          createdAt: "2026-10-03T00:00:00.000Z",
        }),
      ],
      WS_A,
    );
    expect(listed.map((item) => item.sessionId)).toEqual(["new", "old"]);
  });
});

describe("findSkillChatSession (specs/creator「技能维度的续聊精确匹配」)", () => {
  const target = { workspaceId: WS_A, providerId: PROVIDER };

  it("same-skill hit resumes the most recent session — spec scenario", () => {
    const sessions = [
      session({
        sessionId: "older-bash",
        workspaceId: WS_A,
        providerId: "zcode",
        seedSkill: SK_BASH,
        createdAt: "2026-10-01T00:00:00.000Z",
      }),
      session({
        sessionId: "latest-bash",
        workspaceId: WS_A,
        providerId: "zcode",
        seedSkill: SK_BASH,
        createdAt: "2026-10-03T00:00:00.000Z",
      }),
    ];
    expect(findSkillChatSession(sessions, target, SK_BASH)?.sessionId).toBe("latest-bash");
  });

  it("does not resume a session seeded with another skill — spec scenario", () => {
    const sessions = [
      session({ sessionId: "vue", workspaceId: WS_A, providerId: "zcode", seedSkill: SK_VUE }),
      session({ sessionId: "no-seed", workspaceId: WS_A, providerId: "zcode", seedSkill: null }),
    ];
    // bash-utils 详情发起：最近会话 seedSkill=vue-helper → 无匹配（null → 调用方新建）。
    expect(findSkillChatSession(sessions, target, SK_BASH)).toBeNull();
    expect(findSkillChatSession(sessions, target, SK_VUE)?.sessionId).toBe("vue");
  });

  it("requires the provider segment too (workspace-level sessions never match)", () => {
    const sessions = [
      // target 无 providerId = 该 ws 全 provider 会话，不参与 provider 级匹配。
      session({ sessionId: "ws-scope", workspaceId: WS_A, seedSkill: SK_BASH }),
      session({
        sessionId: "zcode-hit",
        workspaceId: WS_A,
        providerId: "zcode",
        seedSkill: SK_BASH,
      }),
    ];
    expect(findSkillChatSession(sessions, target, SK_BASH)?.sessionId).toBe("zcode-hit");
    // 他 provider 同技能不命中（provider 段是查找键的一部分）。
    const cursorTarget = { workspaceId: WS_A, providerId: "cursor" as ProviderId };
    expect(findSkillChatSession(sessions, cursorTarget, SK_BASH)).toBeNull();
  });
});

describe("seed templates (design §2 冻结措辞)", () => {
  it("builds the structured capture prompt with the skill-creator loop verbatim", () => {
    const prompt = buildCreatorSeedPrompt({
      intent: "把部署流程变成技能",
      trigger: "提到发版时",
      examples: "输入 → 输出",
    });
    expect(prompt).toContain(
      "请按 skill-creator 循环推进：先弄清技能要做什么（capture），写出 SKILL.md 草稿（draft），用 2–3 条真实测试话术试跑（test），和我一起读产出并修订（review → improve），循环到足够好为止。",
    );
    expect(prompt).toContain("## 意图：它该让模型做到什么\n把部署流程变成技能");
    expect(prompt).toContain("## 触发：什么用户措辞或上下文该触发它\n提到发版时");
    expect(prompt).toContain("## 示例：输入与期望输出\n输入 → 输出");
    expect(prompt).toContain(
      "落盘一律走 creator_save_propose 工具提案（不直接写文件），等待我在审批面确认。",
    );
    expect(prompt).not.toContain("## 模板起点");
  });

  it("omits optional sections when blank and carries the template seed origin", () => {
    const prompt = buildCreatorSeedPrompt({
      intent: "intent",
      trigger: "",
      examples: "",
      templateName: "code-reviewer",
      templateDescription: "Review code changes.",
    });
    expect(prompt).not.toContain("## 触发");
    expect(prompt).not.toContain("## 示例");
    expect(prompt).toContain("## 模板起点");
    expect(prompt).toContain("以内置模板 code-reviewer 的 frontmatter 与正文为起点改造");
  });

  it("builds the skill chat intro with the `$name` chip token", () => {
    const intro = buildSkillChatIntro("bash-utils");
    // 芯片配对前提：正文必须携带 `$` 前缀 token（与 probe-recall 同法则）。
    expect(intro).toContain("$bash-utils");
    expect(intro).toContain("creator_save_propose");
    expect(intro).toContain("expectedRevision");
  });

  it("freezes the test suggestion prompt shape", () => {
    const prompt = buildTestSuggestionPrompt();
    expect(prompt).toContain("3 条真实测试话术");
    expect(prompt).toContain("「1.」「2.」「3.」");
  });

  it("exposes the advisory loop stage catalog in order", () => {
    expect([...CREATOR_LOOP_STAGES]).toEqual(["capture", "draft", "test", "review", "improve"]);
  });
});

describe("parseTestSuggestions", () => {
  it("extracts numbered lines (dot/、/) capped at five", () => {
    const text = [
      "1. 帮我 review src/app.ts 的错误处理",
      "2、检查 package.json 里漏掉的依赖",
      "3) refactor the utils folder",
      "4. fourth",
      "5. fifth",
      "6. sixth",
      "plain line",
    ].join("\n");
    expect(parseTestSuggestions(text)).toEqual([
      "帮我 review src/app.ts 的错误处理",
      "检查 package.json 里漏掉的依赖",
      "refactor the utils folder",
      "fourth",
      "fifth",
    ]);
  });

  it("returns empty for unnumbered prose", () => {
    expect(parseTestSuggestions("这是一段普通回复，没有编号。")).toEqual([]);
  });
});

describe("draftCardsFromItems (design §2 草稿产出卡)", () => {
  const args = JSON.stringify({
    mode: "update",
    workspaceId: WS_A,
    providerId: "zcode",
    skillId: SK_BASH,
    expectedRevision: `sha256:${"0".repeat(64)}`,
    frontmatter: { name: "bash-utils", description: "Shell helpers." },
    body: "## When to Use\n\nUse for shell tasks.",
  });

  function toolItem(overrides: Partial<Extract<PanelItem, { kind: "tool" }>>): PanelItem {
    return {
      kind: "tool",
      seq: 7,
      toolName: "mcp__skill-creator__creator_save_propose",
      argsText: args,
      phase: "done",
      startedAt: "2026-10-03T00:00:00.000Z",
      ...overrides,
    };
  }

  it("matches the propose tool name in both registered and bare forms", () => {
    expect(isCreatorSaveProposeTool("mcp__skill-creator__creator_save_propose")).toBe(true);
    expect(isCreatorSaveProposeTool("creator_save_propose")).toBe(true);
    expect(isCreatorSaveProposeTool("creator_save")).toBe(false);
    expect(isCreatorSaveProposeTool("mcp__skill-creator__skills_list")).toBe(false);
  });

  it("projects a draft card and deep-extracts the mcp: proposalId from the tool result", () => {
    const result = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            kind: "proposed",
            proposalId: "mcp:prop_123",
            capability: "creator.save",
            status: "pending",
          }),
        },
      ],
    };
    const cards = draftCardsFromItems([toolItem({ result })]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      seq: 7,
      mode: "update",
      name: "bash-utils",
      description: "Shell helpers.",
      proposalId: "mcp:prop_123",
      phase: "done",
      skillId: SK_BASH,
      expectedRevision: `sha256:${"0".repeat(64)}`,
    });
  });

  it("drops cards with malformed args (external frame input is not trusted)", () => {
    expect(draftCardsFromItems([toolItem({ argsText: "{not json" })])).toEqual([]);
    expect(
      draftCardsFromItems([toolItem({ argsText: JSON.stringify({ mode: "create" }) })]),
    ).toEqual([]);
    // 非提案工具行不产卡。
    expect(
      draftCardsFromItems([toolItem({ toolName: "mcp__skill-creator__skills_list" })]),
    ).toEqual([]);
  });

  it("keeps proposalId null while calling and for non-proposed results", () => {
    expect(
      draftCardsFromItems([toolItem({ phase: "calling", result: undefined })])[0],
    ).toMatchObject({ proposalId: null, phase: "calling" });
    expect(draftCardsFromItems([toolItem({ result: { note: "no ids here" } })])[0]).toMatchObject({
      proposalId: null,
    });
  });
});

describe("contract surface (design §5「契约面无 context.skillId 平行字段」)", () => {
  it("AgentSessionSummarySchema has no parallel context field", () => {
    const shape = AgentSessionSummarySchema.shape as Record<string, unknown>;
    expect(Object.keys(shape).sort()).toEqual(
      [
        "sessionId",
        "title",
        "status",
        "cwd",
        "createdAt",
        "mode",
        "target",
        "seedSkill",
        "hasTranscript",
      ].sort(),
    );
    expect(shape.context).toBeUndefined();
    expect(shape.contextSkillId).toBeUndefined();
  });
});
