/**
 * 用户原始需求 [2026-09-30]：「往 ~/.agents/AGENTS.md 中注入或者更新
 * `<skill-creator-v2>$PROMPT</skill-creator-v2>` 片段，这个片段的作用是引导 Agent
 * 使用 skill-creator 去管理和维护和使用 skills，特别是使用 wiki 的部分实现记录
 * 和迭代。」
 *
 * 正交意图：
 *   [1] 引导块文本（$PROMPT，产品代码所有）：常驻指令面只放三条行为规则 + 指针，
 *       工具目录仍由 skill-creator-v2 技能文档承载（单一事实源不搬家）。
 *   [2] 块协议与 ensure 语义：标签对整块替换、块外内容逐字保留、残缺/多块 typed
 *       拒绝；IO 故障不抛出。仅显式 setup 调用——daemon 启动 ensure 不碰用户
 *       全局指令文件（侵入度与技能目录链接不同级）。
 * 妥协声明：块无独立版本号——setup 时以代码内文本整块刷新即版本。
 */
import fs from "node:fs";
import path from "node:path";
import { selfSkillRoot } from "./self-skill.js";
import { atomicWriteUtf8 } from "./path-safety.js";

export { SELF_SKILL_ROOT_ENV } from "./self-skill.js";

const BLOCK_OPEN = "<skill-creator-v2>";
const BLOCK_CLOSE = "</skill-creator-v2>";

/** ensure/只读检查的闭合结果（typed；IO 故障不抛出）。 */
export type AgentsMdBlockResult =
  | { kind: "injected" }
  | { kind: "updated" }
  | { kind: "current" }
  | { kind: "multiple"; file: string }
  | { kind: "failed"; reason: string };

/** 引导块目标文件：全局技能根的父目录下（隔离阀沙箱自洽）。 */
export function agentsMdFilePath(explicitRoot?: string): string {
  return path.join(path.dirname(selfSkillRoot(explicitRoot)), "AGENTS.md");
}

/** $PROMPT 正文（setup 整块刷新；与 skills/skill-creator-v2 技能文档同源演进）。 */
export function agentsMdGuidanceBlock(): string {
  return `${BLOCK_OPEN}
## Skill 管理与沉淀走 skill-creator

- 发现/校验/启停/安装/更新/清理重复技能与跨 Workspace 检索，优先用 skill-creator
  （CLI：\`skill-creator search\`、\`skill-creator skills …\`、\`skill-creator wiki …\`；
  结构化消费注册 stdio MCP：\`skill-creator mcp\`，只读）。不绕过工具面直接改
  技能文件。
- 完整 CLI/MCP 用法与概念模型：读全局技能 \`skill-creator-v2\`
  （~/.agents/skills/skill-creator-v2 的 SKILL.md 与 references/tools.md）。
- 技能使用中形成的经验、踩坑与最佳实践，用 skill wiki 记录与迭代
  （\`skill-creator wiki add/list/show\`；先查重再新增，迭代优于堆积）。
${BLOCK_CLOSE}`;
}

/**
 * 确保引导块在场且与产品文本一致。块外内容逐字保留；首个完整块被整块替换；
 * 多完整块只刷新首个并报 multiple；残缺开标签拒绝写入（防嵌套双块）。
 */
export function ensureAgentsMdPromptBlock(explicitRoot?: string): AgentsMdBlockResult {
  const file = agentsMdFilePath(explicitRoot);
  const block = agentsMdGuidanceBlock();
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      try {
        atomicWriteUtf8(file, `${block}\n`);
      } catch (writeError) {
        return { kind: "failed", reason: describe(file, writeError) };
      }
      return { kind: "injected" };
    }
    return { kind: "failed", reason: describe(file, error) };
  }
  const firstOpen = source.indexOf(BLOCK_OPEN);
  if (firstOpen === -1) {
    const separator =
      source.length === 0
        ? ""
        : source.endsWith("\n\n")
          ? ""
          : source.endsWith("\n")
            ? "\n"
            : "\n\n";
    try {
      atomicWriteUtf8(file, `${source}${separator}${block}\n`);
    } catch (writeError) {
      return { kind: "failed", reason: describe(file, writeError) };
    }
    return { kind: "injected" };
  }
  const close = source.indexOf(BLOCK_CLOSE, firstOpen);
  if (close === -1) {
    return {
      kind: "failed",
      reason: `unterminated ${BLOCK_OPEN} block in ${file}; fix it manually and rerun setup`,
    };
  }
  const secondOpen = source.indexOf(BLOCK_OPEN, firstOpen + BLOCK_OPEN.length);
  const inner = source.slice(firstOpen + BLOCK_OPEN.length, close);
  if (inner.trim() === guidanceBody().trim() && secondOpen === -1) {
    return { kind: "current" };
  }
  try {
    atomicWriteUtf8(
      file,
      source.slice(0, firstOpen) + block + source.slice(close + BLOCK_CLOSE.length),
    );
  } catch (writeError) {
    return { kind: "failed", reason: describe(file, writeError) };
  }
  return secondOpen === -1 ? { kind: "updated" } : { kind: "multiple", file };
}

/** 只读块状态（self-skill status 投影）。 */
export function agentsMdBlockState(explicitRoot?: string): "present" | "absent" | "broken" {
  let source: string;
  try {
    source = fs.readFileSync(agentsMdFilePath(explicitRoot), "utf8");
  } catch {
    return "absent";
  }
  const open = source.indexOf(BLOCK_OPEN);
  if (open === -1) return "absent";
  if (source.indexOf(BLOCK_CLOSE, open) === -1) return "broken";
  return "present";
}

function guidanceBody(): string {
  const block = agentsMdGuidanceBlock();
  const from = block.indexOf("\n") + 1;
  const to = block.lastIndexOf(BLOCK_CLOSE);
  return block.slice(from, to);
}

function describe(file: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `agents-md guidance block update failed at ${file}: ${detail}`;
}
