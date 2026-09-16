/**
 * `@`/`$` 引用展开链测试（composer-references C1 + skill-refs C1）。
 *
 * 用户指示 [2026-09-16]：「继续完善遗留工作。完成 1/2/3」——1 = @ 引用芯片。
 * daemon 展开契约：file 走 agent-files 守卫链（绝对路径/realpath/regular/
 * ≤512KiB/文本扩展名）；session 走转录摘要（user/assistant text 帧有界投影，
 * 思考/工具排除）；展开块注入内核消息 content，经 user-text 帧端到端可见。
 * 用户指示 [2026-09-16]（skill-refs C1）：「AgentChatInput 输入要支持 `$` 开头
 * 引用 skill」——skill 引用经注入的 expandSkillReferences 展开（domain 装配
 * registry 作用域解析 + 文档读取；本文件以注入桩覆盖分支语义）。
 *
 * 正交意图：
 *   [1] resolvePromptReferences 单元面（守卫拒绝的类型化矩阵 + 内联形状）。
 *   [2] 真实内核端到端：prompt 携带引用 → user-text 帧含 [reference: …] 块；
 *       引用缺失在会话复活前 typed NOT_FOUND；引用 prompt 不被 slash 分流吞。
 *   [3] skill 引用：契约 parse（合法三元组/畸形 ID 拒绝）+ 展开块注入与
 *       NOT_FOUND 传播（注入桩承载 domain 语义）。
 * 妥协声明：端到端断言不依赖 LLM 成功（user/message 事件在驱动前即落序）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentFilesService } from "../src/daemon/agent-files.js";
import { DomainError } from "../src/daemon/domain-error.js";
import { bootDshKernel, type DshKernelHandle } from "../src/daemon/kernel/dsh-kernel.js";
import {
  createAgentSessionsService,
  type AgentSessionsService,
  type SkillReferenceInput,
} from "../src/daemon/kernel/agent-sessions.js";
import { createSessionTranscripts } from "../src/daemon/kernel/session-transcripts.js";
import type { DshSessionStreamFrame } from "../src/shared/contracts/dsh-runtime.js";
import { AgentSessionPromptInputSchema } from "../src/shared/contracts/agent.js";
import { SkillIdSchema } from "../src/shared/contracts/skills.js";
import { WorkspaceProviderTargetSchema } from "../src/shared/contracts/workspaces.js";

let sandbox = "";
let kernel: DshKernelHandle | null = null;
let service: AgentSessionsService | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "agent-references-test-"));
});

afterEach(async () => {
  await service?.dispose().catch(() => undefined);
  service = null;
  await kernel?.dispose().catch(() => undefined);
  kernel = null;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function makeService(transcriptsRoot: string): AgentSessionsService {
  const agentFiles = createAgentFilesService();
  return createAgentSessionsService({
    kernel: () => kernel,
    modelSelection: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
    defaultMode: async () => "free",
    transcripts: createSessionTranscripts(transcriptsRoot),
    expandFileReferences: (references) => agentFiles.resolvePromptReferences({ references }),
  });
}

describe("agent-files resolvePromptReferences (C1 unit)", () => {
  it("inlines a textual file as a [reference: …] block with its canonical path", async () => {
    const fileDir = path.join(sandbox, "docs");
    fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(path.join(fileDir, "notes.md"), "# Notes\nfirst reference body");
    const files = createAgentFilesService();
    const blocks = await files.resolvePromptReferences({
      references: [{ kind: "file", path: path.join(fileDir, "notes.md") }],
    });
    expect(blocks).toHaveLength(1);
    // canonical 路径（macOS realpath 会加 /private 前缀——与服务端同事实源）。
    expect(blocks[0]).toContain(`[reference: ${fs.realpathSync(path.join(fileDir, "notes.md"))}]`);
    expect(blocks[0]).toContain("# Notes");
    expect(blocks[0]).toContain("first reference body");
  });

  it("rejects binary extensions with typed INVALID_OPERATION pointing to attachments", async () => {
    fs.writeFileSync(path.join(sandbox, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const files = createAgentFilesService();
    await expect(
      files.resolvePromptReferences({
        references: [{ kind: "file", path: path.join(sandbox, "logo.png") }],
      }),
    ).rejects.toThrowError(/not a textual file; attach it instead/);
  });

  it("rejects oversized files (>512KiB) and relative paths", async () => {
    fs.writeFileSync(path.join(sandbox, "big.md"), "x".repeat(512 * 1024 + 1));
    const files = createAgentFilesService();
    await expect(
      files.resolvePromptReferences({
        references: [{ kind: "file", path: path.join(sandbox, "big.md") }],
      }),
    ).rejects.toThrowError(/exceeds the 512KiB limit/);
    await expect(
      files.resolvePromptReferences({ references: [{ kind: "file", path: "relative/md" }] }),
    ).rejects.toThrowError(/absolute reference path required/);
  });

  it("maps missing files to typed NOT_FOUND", async () => {
    const files = createAgentFilesService();
    const failure = await files
      .resolvePromptReferences({
        references: [{ kind: "file", path: path.join(sandbox, "gone.md") }],
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as DomainError).code).toBe("NOT_FOUND");
  });
});

describe("agent sessions reference expansion (C1, real kernel)", () => {
  it("rejects a missing referenced session before any kernel work", async () => {
    service = makeService(path.join(sandbox, "transcripts"));
    // 内核未挂载：缺失会话引用必须在 requireKernel 之前以 NOT_FOUND 失败。
    await expect(
      service.prompt("agent-live", "see earlier", [], [], "queue", [
        { kind: "session", sessionId: "agent-missing" },
      ]),
    ).rejects.toThrowError(/referenced session not found/);
  });

  it(
    "injects file and session reference blocks into the kernel message",
    { timeout: 180_000 },
    async () => {
      const transcriptsRoot = path.join(sandbox, "transcripts");
      fs.mkdirSync(transcriptsRoot, { recursive: true });
      fs.writeFileSync(path.join(sandbox, "spec.md"), "reference body from spec.md");

      // 播种一条历史会话转录（user/assistant text + 一条 tool 帧——tool 必须被摘要排除）。
      const transcripts = createSessionTranscripts(transcriptsRoot);
      transcripts.recordStart({
        sessionId: "agent-earlier",
        title: "earlier chat",
        createdAt: new Date().toISOString(),
        cwd: sandbox,
        mode: "free",
      });
      const frame = (
        seq: number,
        kind: DshSessionStreamFrame["kind"],
        text: string,
      ): DshSessionStreamFrame => ({
        at: new Date().toISOString(),
        runId: "agent-earlier",
        sessionId: "agent-earlier",
        seq,
        kind,
        text,
      });
      transcripts.append("agent-earlier", frame(1, "user-text", "how do skills toggle?"));
      transcripts.append("agent-earlier", frame(2, "assistant-text", "through the MCP face"));
      transcripts.append("agent-earlier", frame(3, "tool-call", "ignored"));

      kernel = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
      service = makeService(transcriptsRoot);
      service.attach(kernel);
      const session = await service.create({ cwd: sandbox });

      await service.prompt(
        session.sessionId,
        "see @spec.md and the earlier chat",
        [],
        [],
        "queue",
        [
          { kind: "file", path: path.join(sandbox, "spec.md") },
          { kind: "session", sessionId: "agent-earlier" },
        ],
      );

      let userText = "";
      for (let i = 0; i < 20 && userText === ""; i += 1) {
        const frames = service.stream(session.sessionId, 0, 200).frames;
        const hit = frames.find(
          (frame) => frame.kind === "user-text" && frame.text.includes("spec.md"),
        );
        if (hit?.text) userText = hit.text;
        else await new Promise((resolve) => setTimeout(resolve, 300));
      }
      // user-text 帧文本 = content 全部 text 块拼接：正文 + 两个引用块都在场。
      expect(userText).toContain("see @spec.md and the earlier chat");
      expect(userText).toContain(`[reference: ${fs.realpathSync(path.join(sandbox, "spec.md"))}]`);
      expect(userText).toContain("reference body from spec.md");
      expect(userText).toContain(`[reference: earlier session "earlier chat" (agent-earlier)]`);
      expect(userText).toContain("user: how do skills toggle?");
      expect(userText).toContain("assistant: through the MCP face");
      expect(userText).not.toContain("ignored");
    },
  );

  it(
    "does not route a reference-carrying /prefixed prompt into the slash command path",
    { timeout: 180_000 },
    async () => {
      fs.writeFileSync(path.join(sandbox, "cmd.md"), "command context");
      kernel = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
      service = makeService(path.join(sandbox, "transcripts"));
      service.attach(kernel);
      const session = await service.create({ cwd: sandbox });

      await service.prompt(session.sessionId, "/compact with a reference", [], [], "queue", [
        { kind: "file", path: path.join(sandbox, "cmd.md") },
      ]);

      let userText = "";
      for (let i = 0; i < 20 && userText === ""; i += 1) {
        const frames = service.stream(session.sessionId, 0, 200).frames;
        const hit = frames.find(
          (frame) => frame.kind === "user-text" && frame.text.includes("reference"),
        );
        if (hit?.text) userText = hit.text;
        else await new Promise((resolve) => setTimeout(resolve, 300));
      }
      // 若被命令分流吞掉，user-text 帧不会出现（命令不进对话流）。
      expect(userText).toContain("/compact with a reference");
      expect(userText).toContain("command context");
    },
  );
});

describe("skill references ($ trigger, skill-refs C1)", () => {
  const skillId = SkillIdSchema.parse("sk_0123456789abcdef01234567");
  /** branded 作用域构造（契约 parse = 与 RPC 边界同源）。 */
  const stubTarget = WorkspaceProviderTargetSchema.parse({
    workspaceId: "~",
    providerId: "agents",
  });

  /** domain 装配语义的注入桩（registry 作用域解析 + 文档读取由 domain 测试覆盖；
   *  本桩承载 agent-sessions 的分支/传播语义）。 */
  function stubSkillExpander(
    blocks: Map<string, string> = new Map([["sk_0123456789abcdef01234567", "# Stub Skill\nbody"]]),
  ) {
    return async (references: SkillReferenceInput[]): Promise<string[]> => {
      const out: string[] = [];
      for (const reference of references) {
        const content = blocks.get(String(reference.skillId));
        if (content === undefined) {
          throw new DomainError(
            "NOT_FOUND",
            `Skill not found in Workspace Provider: ${String(reference.skillId)}`,
          );
        }
        out.push(`[reference: skill stub · provider]\n${content.slice(0, 200_000)}`);
      }
      return out;
    };
  }

  it("parses the skill reference triple and rejects malformed ids at the contract boundary", () => {
    const parsed = AgentSessionPromptInputSchema.safeParse({
      sessionId: "agent-live",
      text: "use $stub",
      references: [
        {
          kind: "skill",
          workspaceId: "~",
          providerId: "agents",
          skillId: "sk_0123456789abcdef01234567",
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.references[0]).toMatchObject({ kind: "skill", providerId: "agents" });
    }
    // 畸形三元组：非 sk_ 形状的 skillId / 未知字段一律拒。
    expect(
      AgentSessionPromptInputSchema.safeParse({
        sessionId: "agent-live",
        text: "use $stub",
        references: [
          { kind: "skill", workspaceId: "~", providerId: "agents", skillId: "not-an-id" },
        ],
      }).success,
    ).toBe(false);
    expect(
      AgentSessionPromptInputSchema.safeParse({
        sessionId: "agent-live",
        text: "use $stub",
        references: [
          {
            kind: "skill",
            workspaceId: "~",
            providerId: "agents",
            skillId: "sk_0123456789abcdef01234567",
            extra: true,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a missing referenced skill before any kernel work (typed NOT_FOUND)", async () => {
    service = createAgentSessionsService({
      kernel: () => kernel,
      modelSelection: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
      defaultMode: async () => "free",
      transcripts: createSessionTranscripts(path.join(sandbox, "transcripts")),
      expandSkillReferences: stubSkillExpander(new Map()),
    });
    const failure = await service
      .prompt("agent-live", "use $gone", [], [], "queue", [
        { kind: "skill", ...stubTarget, skillId },
      ])
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as DomainError).code).toBe("NOT_FOUND");
  });

  it(
    "injects the skill reference block into the kernel message (real kernel)",
    { timeout: 180_000 },
    async () => {
      kernel = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
      service = createAgentSessionsService({
        kernel: () => kernel,
        modelSelection: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
        defaultMode: async () => "free",
        transcripts: createSessionTranscripts(path.join(sandbox, "transcripts")),
        expandSkillReferences: stubSkillExpander(),
      });
      service.attach(kernel);
      const session = await service.create({ cwd: sandbox });
      await service.prompt(session.sessionId, "use $stub please", [], [], "queue", [
        { kind: "skill", ...stubTarget, skillId },
      ]);

      let userText = "";
      for (let i = 0; i < 20 && userText === ""; i += 1) {
        const frames = service.stream(session.sessionId, 0, 200).frames;
        const hit = frames.find(
          (frame) => frame.kind === "user-text" && frame.text.includes("$stub"),
        );
        if (hit?.text) userText = hit.text;
        else await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(userText).toContain("use $stub please");
      expect(userText).toContain("[reference: skill stub · provider]");
      expect(userText).toContain("# Stub Skill");
    },
  );
});
