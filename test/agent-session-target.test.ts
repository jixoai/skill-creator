/**
 * 会话 target binding 契约测试（skills-agent-page tasks 1.1/1.1b；spec delta
 * agent-kernel 的 7 个 Scenario 全集 + design §6 六态）。
 *
 * 用户原始需求 [2026-10-03]（design §2 契约定稿）：「归属升级为带 server
 * enforcement 的完整契约——创建校验 / 不可变 / 无 target 只读 / mcp *_propose
 * 链越权拒绝 / summary 直投影。」
 *
 * 正交意图：
 *   [1] 创建校验：未知 ws/provider typed 拒绝（不建会话不写 meta，内核零接触）；
 *       target 落 meta；setMode 后保留（复活链从 meta 读回）。
 *   [2] summary 投影：target 直投影 + seedSkill 必填 nullable（无 seed = null）。
 *   [3] mcp *_propose 链 enforcement：无归属 / Global 只读 / 跨 ws / provider
 *       不匹配 / 配置域写入 typed 拒绝，无 proposal 落库 + 审计含会话 id 与
 *       目标三元组；非会话调用不在管辖；同工具名多会话 fail-closed。
 * 妥协声明：stub 内核（agent-queue 同法则）钉死服务语义；真实内核行为归
 *   agent-sessions.test.ts 既有套件。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgentSessionsService,
  type AgentSessionsService,
} from "../src/daemon/kernel/agent-sessions.js";
import type { DshKernelHandle } from "../src/daemon/kernel/dsh-kernel.js";
import { createSessionTranscripts } from "../src/daemon/kernel/session-transcripts.js";
import { summaryOfMeta } from "../src/daemon/kernel/session-transcripts.js";
import {
  createMcpProposalStore,
  proposeToolNameOf,
  type McpProposalStore,
  type ProposeCallSession,
} from "../src/daemon/mcp/proposals.js";
import { createCapabilityRegistry } from "../src/daemon/capability/core.js";
import { DomainError } from "../src/daemon/domain-error.js";
import { ImportedWorkspaceIdSchema } from "../src/shared/contracts/workspaces.js";
import { SkillIdSchema } from "../src/shared/contracts/skills.js";

const WS_A = ImportedWorkspaceIdSchema.parse(`ws_${"a".repeat(23)}1`);
const WS_B = ImportedWorkspaceIdSchema.parse(`ws_${"b".repeat(23)}2`);
const PROVIDER_ZCODE = "zcode" as const;
const PROVIDER_AGENTS = "agents" as const;

let sandbox = "";
let service: AgentSessionsService | null = null;
let transcriptsRoot = "";

/** 校验 stub：registry 只认识 WS_A(zcode/agents) 与 WS_B(agents)。 */
function makeValidateTarget() {
  const known = new Map<string, string[]>([
    [WS_A, [PROVIDER_ZCODE, PROVIDER_AGENTS]],
    [WS_B, [PROVIDER_AGENTS]],
  ]);
  return async (target: { workspaceId: string; providerId?: string }): Promise<void> => {
    const providers = known.get(target.workspaceId);
    if (providers === undefined) {
      throw new DomainError("NOT_FOUND", `workspace not found: ${target.workspaceId}`);
    }
    if (target.providerId !== undefined && !providers.includes(target.providerId)) {
      throw new DomainError(
        "INVALID_OPERATION",
        `provider ${target.providerId} is not part of workspace ${target.workspaceId}`,
      );
    }
  };
}

/** stub 内核（agent-queue 同法则）+ resume 面（setMode 复活链）+ 计数器。 */
function makeStubKernel() {
  const created: string[] = [];
  const resumed: string[] = [];
  let nextAgent: {
    id: string;
    status: string;
    session: { id: string; header: { cwd: string } };
    followup(): void;
    cancel(): void;
    ctx: { on: () => () => undefined };
  } | null = null;
  const kernel = {
    ctx: {
      agents: {
        create: async (options: { sessionId: string }) => {
          created.push(options.sessionId);
          const agent = {
            id: options.sessionId,
            status: "idle" as string,
            session: { id: options.sessionId, header: { cwd: sandbox } },
            followup(): void {},
            cancel(): void {},
            ctx: { on: () => () => undefined },
          };
          nextAgent = agent;
          return { agent, dispose: async () => undefined };
        },
        resume: async (options: { resumeSessionId: string }) => {
          resumed.push(options.resumeSessionId);
          const agent = {
            id: options.resumeSessionId,
            status: "idle" as string,
            session: { id: options.resumeSessionId, header: { cwd: sandbox } },
            followup(): void {},
            cancel(): void {},
            ctx: { on: () => () => undefined },
          };
          nextAgent = agent;
          return { agent, dispose: async () => undefined };
        },
      },
      sessions: { list: () => [], get: () => null },
    },
  } as unknown as DshKernelHandle;
  return { kernel, created, resumed };
}

function makeService(): {
  service: AgentSessionsService;
  created: string[];
  resumed: string[];
} {
  const stub = makeStubKernel();
  service = createAgentSessionsService({
    kernel: () => stub.kernel,
    modelSelection: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
    defaultMode: async () => "free",
    transcripts: createSessionTranscripts(transcriptsRoot),
    validateTarget: makeValidateTarget(),
  });
  return { service, created: stub.created, resumed: stub.resumed };
}

const SEED_METADATA = {
  kind: "test-run" as const,
  workspaceId: WS_A,
  providerId: PROVIDER_ZCODE,
  skillId: SkillIdSchema.parse(`sk_${"c".repeat(23)}1`),
  revision: `sha256:${"a".repeat(64)}`,
  templateId: "tpl-probe",
  templateVersion: 1,
};

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "agent-target-test-"));
  transcriptsRoot = path.join(sandbox, "transcripts");
});

afterEach(async () => {
  await service?.dispose().catch(() => undefined);
  service = null;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("Scenario: 未知 workspace 创建即拒", () => {
  it("rejects an unknown target workspace before any kernel work or meta write", async () => {
    const harness = makeService();
    const WS_UNKNOWN = ImportedWorkspaceIdSchema.parse(`ws_${"d".repeat(24)}`);
    await expect(
      harness.service.create({ target: { workspaceId: WS_UNKNOWN } }),
    ).rejects.toThrowError(new RegExp(`workspace not found: ${WS_UNKNOWN}`));
    // 不建会话（内核零接触）、不写转录 meta。
    expect(harness.created).toEqual([]);
    expect(createSessionTranscripts(transcriptsRoot).listAll()).toEqual([]);
  });

  it("rejects a provider outside the workspace projection without side effects", async () => {
    const harness = makeService();
    await expect(
      harness.service.create({ target: { workspaceId: WS_A, providerId: "unknown" } }),
    ).rejects.toThrowError(/provider unknown is not part of workspace/);
    expect(harness.created).toEqual([]);
    expect(createSessionTranscripts(transcriptsRoot).listAll()).toEqual([]);
  });

  it("fail-closes when target validation is not wired (cannot prove ownership)", async () => {
    const stub = makeStubKernel();
    const unwired = createAgentSessionsService({
      kernel: () => stub.kernel,
      modelSelection: async () => ({ provider: "deepseek-official", model: "m" }),
      defaultMode: async () => "free",
      transcripts: createSessionTranscripts(transcriptsRoot),
    });
    service = unwired;
    await expect(unwired.create({ target: { workspaceId: WS_A } })).rejects.toThrowError(
      /target validation is not wired/,
    );
    expect(stub.created).toEqual([]);
  });
});

describe("Scenario: target 与 seedSkill 的 summary 投影", () => {
  it("projects target and seeded skillSkill into create/list summaries", async () => {
    const harness = makeService();
    const created = await harness.service.create({
      target: { workspaceId: WS_A, providerId: PROVIDER_ZCODE },
      metadata: SEED_METADATA,
    });
    expect(created.target).toEqual({ workspaceId: WS_A, providerId: PROVIDER_ZCODE });
    expect(created.seedSkill).toBe(SEED_METADATA.skillId);
    // list 投影同形（UI 分组与 Creator 过滤零额外 RPC）。
    const listed = harness.service.list().find((item) => item.sessionId === created.sessionId);
    expect(listed?.target).toEqual({ workspaceId: WS_A, providerId: PROVIDER_ZCODE });
    expect(listed?.seedSkill).toBe(SEED_METADATA.skillId);
    // 落盘 meta 与内存一致（mode/seed/target 同层）。
    const meta = createSessionTranscripts(transcriptsRoot)
      .listAll()
      .find((item) => item.sessionId === created.sessionId);
    expect(meta?.target).toEqual({ workspaceId: WS_A, providerId: PROVIDER_ZCODE });
  });

  it("projects seedSkill=null (not absent) for sessions without a seed", async () => {
    const harness = makeService();
    const created = await harness.service.create({ target: { workspaceId: WS_A } });
    expect(created.seedSkill).toBeNull();
    expect(
      harness.service.list().find((item) => item.sessionId === created.sessionId)?.seedSkill,
    ).toBeNull();
  });

  it("summaryOfMeta projects legacy metas as unassigned with seedSkill=null", () => {
    const summary = summaryOfMeta({
      sessionId: "agent-legacy",
      title: "",
      createdAt: new Date().toISOString(),
      cwd: "/tmp",
      mode: "free",
    });
    expect(summary.target).toBeUndefined();
    expect(summary.seedSkill).toBeNull();
  });
});

describe("Scenario: target 经模式切换保留", () => {
  it("keeps the same target through setMode (meta rewrite) and the revive chain", async () => {
    const harness = makeService();
    const created = await harness.service.create({ target: { workspaceId: WS_A } });
    const switched = await harness.service.setMode(created.sessionId, "create");
    expect(switched.target).toEqual({ workspaceId: WS_A });
    expect(switched.seedSkill).toBeNull();
    // 复活链（prompt → agents.resume）后 meta target 原样读回。
    await harness.service.prompt(created.sessionId, "continue");
    expect(harness.resumed).toEqual([created.sessionId]);
    const meta = createSessionTranscripts(transcriptsRoot)
      .listAll()
      .find((item) => item.sessionId === created.sessionId);
    expect(meta?.target).toEqual({ workspaceId: WS_A });
    expect(meta?.mode).toBe("create");
    // list 仍直投影同一 target。
    expect(
      harness.service.list().find((item) => item.sessionId === created.sessionId)?.target,
    ).toEqual({ workspaceId: WS_A });
  });
});

/** 构造带归属 seam 的 proposal store（enforcement 单测）。 */
function makeStore(sessions: ReadonlyArray<ProposeCallSession>): McpProposalStore {
  return createMcpProposalStore(createCapabilityRegistry([]), {
    attributeProposeCalls: (toolName) =>
      toolName.startsWith("mcp__skill-creator__") && toolName.endsWith("_propose") ? sessions : [],
  });
}

describe("Scenario: 旧会话（无 target）只读——proposal 链拒绝", () => {
  it("rejects a write proposal with SESSION_TARGET_UNASSIGNED, no proposal persisted, audited", () => {
    const store = makeStore([{ sessionId: "agent-legacy", target: undefined }]);
    expect(() =>
      store.create("skills.toggle", {
        workspaceId: WS_A,
        providerId: PROVIDER_ZCODE,
        skillIds: ["sk_1"],
        mode: "disable",
      }),
    ).toThrowError(/SESSION_TARGET_UNASSIGNED/);
    expect(store.list()).toEqual([]);
    const audit = store.audit().at(-1);
    expect(audit?.event).toBe("target-rejected");
    expect(audit?.sessionId).toBe("agent-legacy");
    expect(audit?.detail).toContain(`${WS_A}/${PROVIDER_ZCODE}`);
  });
});

describe("Scenario: Global target 会话拒绝一切写入 proposal", () => {
  it("rejects every write proposal shape, including manager-scoped ones", () => {
    const store = makeStore([{ sessionId: "agent-global", target: { workspaceId: "~" } }]);
    expect(() =>
      store.create("skills.toggle", {
        workspaceId: WS_A,
        providerId: PROVIDER_ZCODE,
        skillIds: ["sk_1"],
        mode: "disable",
      }),
    ).toThrowError(/SESSION_TARGET_GLOBAL_READONLY/);
    expect(() => store.create("workspace.add", { path: "/tmp/x", label: "x" })).toThrowError(
      /SESSION_TARGET_GLOBAL_READONLY/,
    );
    expect(store.list()).toEqual([]);
  });
});

describe("Scenario: 跨 workspace proposal 执行前拒绝", () => {
  it("rejects a proposal targeting workspace B from a session bound to workspace A", () => {
    const store = makeStore([{ sessionId: "agent-a", target: { workspaceId: WS_A } }]);
    expect(() =>
      store.create("skills.toggle", {
        workspaceId: WS_B,
        providerId: PROVIDER_AGENTS,
        skillIds: ["sk_1"],
        mode: "disable",
      }),
    ).toThrowError(/SESSION_TARGET_WORKSPACE_SCOPE/);
    expect(store.list()).toEqual([]);
    const audit = store.audit().at(-1);
    expect(audit?.event).toBe("target-rejected");
    expect(audit?.detail).toContain(`${WS_B}/${PROVIDER_AGENTS}`);
    expect(audit?.detail).toContain(`sessionTarget=${WS_A}/*`);
  });

  it("rejects a repository.install when any target array entry leaves the scope", () => {
    const store = makeStore([{ sessionId: "agent-a", target: { workspaceId: WS_A } }]);
    expect(() =>
      store.create("repository.install", {
        sessionId: "repo_x",
        skillIds: ["rsk_1"],
        targets: [
          { workspaceId: WS_A, providerId: PROVIDER_ZCODE },
          { workspaceId: WS_B, providerId: PROVIDER_AGENTS },
        ],
      }),
    ).toThrowError(/SESSION_TARGET_WORKSPACE_SCOPE/);
  });

  it("maps wiki.append scope to the write workspace", () => {
    const store = makeStore([{ sessionId: "agent-a", target: { workspaceId: WS_A } }]);
    expect(() => store.create("wiki.append", { scope: WS_B, title: "t", body: "b" })).toThrowError(
      /SESSION_TARGET_WORKSPACE_SCOPE/,
    );
    expect(() => store.create("wiki.append", { scope: WS_A, title: "t", body: "b" })).not.toThrow();
    store.list().forEach((view) => expect(view.status).toBe("pending"));
  });
});

describe("Scenario: provider 不匹配的 proposal 执行前拒绝", () => {
  it("rejects a zcode-bound session proposing to the agents provider", () => {
    const store = makeStore([
      { sessionId: "agent-z", target: { workspaceId: WS_A, providerId: PROVIDER_ZCODE } },
    ]);
    expect(() =>
      store.create("skills.toggle", {
        workspaceId: WS_A,
        providerId: PROVIDER_AGENTS,
        skillIds: ["sk_1"],
        mode: "disable",
      }),
    ).toThrowError(/SESSION_TARGET_PROVIDER_SCOPE/);
    expect(store.list()).toEqual([]);
    const audit = store.audit().at(-1);
    expect(audit?.sessionId).toBe("agent-z");
    expect(audit?.detail).toContain(`${WS_A}/${PROVIDER_AGENTS}`);
    expect(audit?.detail).toContain(`sessionTarget=${WS_A}/${PROVIDER_ZCODE}`);
  });

  it("rejects a provider-less (workspace-wide) write when the session target pins one provider", () => {
    const store = makeStore([
      { sessionId: "agent-z", target: { workspaceId: WS_A, providerId: PROVIDER_ZCODE } },
    ]);
    // 写入面无 provider 维度 = 覆盖整个 workspace（比 pinned provider 更宽）→ 越权。
    expect(() => store.create("workspace.setActive", { id: WS_A })).toThrowError(
      /SESSION_TARGET_PROVIDER_SCOPE/,
    );
    expect(store.list()).toEqual([]);
  });
});

describe("enforcement 边界语义", () => {
  it("rejects manager-scoped writes (no workspace target extractable) fail-closed", () => {
    const store = makeStore([{ sessionId: "agent-a", target: { workspaceId: WS_A } }]);
    expect(() => store.create("workspace.add", { path: "/tmp/new-ws" })).toThrowError(
      /SESSION_TARGET_UNSCOPED/,
    );
    expect(() => store.create("repository.sources.add", { gitUrl: "https://x.git" })).toThrowError(
      /SESSION_TARGET_UNSCOPED/,
    );
  });

  it("allows in-scope proposals and leaves unattributed callers unaffected", () => {
    const pinned = makeStore([
      { sessionId: "agent-z", target: { workspaceId: WS_A, providerId: PROVIDER_ZCODE } },
    ]);
    expect(() =>
      pinned.create("creator.save", {
        mode: "update",
        workspaceId: WS_A,
        providerId: PROVIDER_ZCODE,
        skillId: "sk_1",
        expectedRevision: `sha256:${"b".repeat(64)}`,
        frontmatter: { name: "x" },
        body: "",
      }),
    ).not.toThrow();
    // 非会话调用（外部 MCP client / 蒸馏链）：无归属——人工审批照旧兜底。
    const external = makeStore([]);
    expect(() =>
      external.create("skills.toggle", {
        workspaceId: WS_B,
        providerId: PROVIDER_AGENTS,
        skillIds: ["sk_1"],
        mode: "disable",
      }),
    ).not.toThrow();
  });

  it("fail-closes when multiple sessions hold the same propose tool in flight", () => {
    const store = makeStore([
      { sessionId: "agent-ok", target: { workspaceId: WS_A } },
      { sessionId: "agent-out", target: { workspaceId: WS_B } },
    ]);
    expect(() =>
      store.create("skills.toggle", {
        workspaceId: WS_A,
        providerId: PROVIDER_ZCODE,
        skillIds: ["sk_1"],
        mode: "disable",
      }),
    ).toThrowError(/SESSION_TARGET/);
    expect(store.list()).toEqual([]);
  });

  it("proposeToolNameOf mirrors the MCP tool naming convention", () => {
    expect(proposeToolNameOf("skills.toggle")).toBe("mcp__skill-creator__skills_toggle_propose");
    expect(proposeToolNameOf("wiki.distill_apply")).toBe(
      "mcp__skill-creator__wiki_distill_apply_propose",
    );
  });
});

describe("domain 装配接线（真实 workspace registry 的创建校验）", () => {
  it("validates targets against the real registry before kernel mount (typed ordering proof)", async () => {
    const { createDaemonDomain } = await import("../src/daemon/domain.js");
    const { setHomeOverride } = await import("../src/shared/paths.js");
    const previousHome = process.env.SKILL_CREATOR_HOME;
    const isolatedHome = path.join(sandbox, "state");
    process.env.SKILL_CREATOR_HOME = isolatedHome;
    setHomeOverride(isolatedHome);
    const domain = createDaemonDomain(undefined, { probeWarmup: false });
    try {
      const wsDir = path.join(sandbox, "imported-ws");
      fs.mkdirSync(wsDir, { recursive: true });
      const imported = domain.workspaces.import(wsDir);
      // 未知 ws：校验层 typed NOT_FOUND（内核未挂载也不先报 UNAVAILABLE——校验先行）。
      const WS_UNKNOWN = ImportedWorkspaceIdSchema.parse(`ws_${"e".repeat(24)}`);
      await expect(
        domain.agentSessions.create({ target: { workspaceId: WS_UNKNOWN } }),
      ).rejects.toThrowError(new RegExp(`workspace not found: ${WS_UNKNOWN}`));
      // 已注册 ws：校验通过 → 下一个失败点是内核未挂载（UNAVAILABLE），且不写 meta。
      await expect(
        domain.agentSessions.create({ target: { workspaceId: imported.id } }),
      ).rejects.toThrowError(/kernel is not mounted/);
    } finally {
      await domain.terminal.dispose({ graceMs: 300 }).catch(() => undefined);
      await domain.repository.dispose().catch(() => undefined);
      setHomeOverride(null);
      if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
      else process.env.SKILL_CREATOR_HOME = previousHome;
    }
  });
});
