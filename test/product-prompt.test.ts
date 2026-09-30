/**
 * 产品提示词最佳实践测试（dsh-kernel-rebase task 4.3；self-skill-bootstrap v2）。
 *
 * 用户原始需求 [2026-09-08]：「提示词上针对如何使用 skill-creator-mcp 给出明确的
 * 最佳实践，让 AI 在合适的时候使用 MCP-apps 来提供视觉卡片就行。」
 * 修订 [2026-09-30]：能力面用法不再内嵌——指针到全局技能 skill-creator-v2
 * （skills_search → skills_info 普通流程读取）。
 *
 * 正交意图：
 *   [1] 版本化纪律：section 文本携带版本号；关键约定（无 shell/指针配方/审批
 *       语义/卡片最佳实践）逐项在场。
 *   [2] 指针化纪律：不内嵌工具目录枚举（单一事实源在全局技能文档）。
 *   [3] 注册面：registerProductPromptSections 经 agent scope 注册（幂等键 =
 *       section name）。
 * 妥协声明：真实会话的引导效果取证归端到端（需要 LLM 凭据）。
 */
import { describe, expect, it } from "vitest";
import {
  PRODUCT_PERSONA_TEXT,
  SKILL_CREATOR_PROMPT_SECTION_NAME,
  SKILL_CREATOR_PROMPT_SECTION_TEXT,
  SKILL_CREATOR_PROMPT_VERSION,
  registerProductPromptSections,
} from "../src/daemon/kernel/product-prompt.js";
import { SELF_SKILL_DIRECTORY_NAME } from "../src/daemon/self-skill.js";

describe("product prompt best practices (task 4.3 / self-skill v2)", () => {
  it("carries the version marker in the section text", () => {
    expect(SKILL_CREATOR_PROMPT_SECTION_TEXT).toContain(`v${SKILL_CREATOR_PROMPT_VERSION}`);
  });

  it("keeps the no-shell rule, approval semantics, and card guidance inline", () => {
    const text = SKILL_CREATOR_PROMPT_SECTION_TEXT;
    expect(text).toContain("mcp__skill-creator__");
    expect(text).toContain("no shell or filesystem access");
    expect(text).toContain("proposals");
    expect(text).toContain("human approves");
    expect(text).toContain("uiCard");
    expect(text).toContain("ui://");
    expect(text).toContain("ask_user_question");
  });

  it("points to the global self skill instead of inlining the usage guide", () => {
    const text = SKILL_CREATOR_PROMPT_SECTION_TEXT;
    expect(text).toContain(SELF_SKILL_DIRECTORY_NAME);
    expect(text).toContain("~/.agents/skills");
    // 指针配方：search 定位三元组 → info 读全文（普通流程，非内嵌）。
    expect(text).toContain("skills_search");
    expect(text).toContain("skills_info");
    expect(text).toContain("{workspaceId, providerId, skillId}");
    expect(text).toContain("usage guide is NOT inlined");
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
