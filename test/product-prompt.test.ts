/**
 * 产品提示词最佳实践测试（dsh-kernel-rebase task 4.3）。
 *
 * 用户原始需求 [2026-09-08]：「提示词上针对如何使用 skill-creator-mcp 给出明确的
 * 最佳实践，让 AI 在合适的时候使用 MCP-apps 来提供视觉卡片。」
 *
 * 正交意图：
 *   [1] 版本化纪律：section 文本携带版本号；关键约定（能力面/无 shell/卡片
 *       最佳实践/审批语义）逐项在场。
 *   [2] 注册面：registerProductPromptSections 经 agent scope 注册（幂等键 =
 *       section name）。
 * 妥协声明：真实会话的引导效果取证归阶段 6 端到端（需要 LLM 凭据）。
 */
import { describe, expect, it } from "vitest";
import {
  PRODUCT_PERSONA_TEXT,
  SKILL_CREATOR_PROMPT_SECTION_NAME,
  SKILL_CREATOR_PROMPT_SECTION_TEXT,
  SKILL_CREATOR_PROMPT_VERSION,
  registerProductPromptSections,
} from "../src/daemon/kernel/product-prompt.js";

describe("product prompt best practices (task 4.3)", () => {
  it("carries the version marker in the section text", () => {
    expect(SKILL_CREATOR_PROMPT_SECTION_TEXT).toContain(`v${SKILL_CREATOR_PROMPT_VERSION}`);
  });

  it("states the capability face, no-shell rule, approval semantics, and card guidance", () => {
    const text = SKILL_CREATOR_PROMPT_SECTION_TEXT;
    expect(text).toContain("mcp__skill-creator__");
    expect(text).toContain("no shell or filesystem access");
    expect(text).toContain("proposals");
    expect(text).toContain("human approves");
    expect(text).toContain("uiCard");
    expect(text).toContain("ui://");
    expect(text).toContain("ask_user_question");
  });

  it("registers one scoped section keyed by stable name", () => {
    const sections: unknown[] = [];
    registerProductPromptSections({
      systemPrompt: {
        section: (section: unknown) => {
          sections.push(section);
          return () => undefined;
        },
      },
    });
    expect(sections).toHaveLength(1);
    expect((sections[0] as { name: string }).name).toBe(SKILL_CREATOR_PROMPT_SECTION_NAME);
    expect(typeof (sections[0] as { text: string }).text).toBe("string");
  });

  it("keeps the persona aligned with the preset authored at kernel boot", () => {
    expect(PRODUCT_PERSONA_TEXT).toContain("Skill Creator agent");
    expect(PRODUCT_PERSONA_TEXT).toContain("not part of this product session");
  });
});
