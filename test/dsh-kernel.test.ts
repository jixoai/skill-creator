/**
 * DSH headless 内核组合测试（dsh-kernel-rebase task 2.1）。
 *
 * 用户原始需求 [2026-09-08]：「我需要的是 DSH 的内核。」
 * 验收锚点（tasks 2.1）：内核 rows 激活（agent/session/settings/approval/permission
 * facts）；无 web rows；**负面场景钉死**——全局工具表只含受控注册，bash/fs 类
 * 通用能力对产品会话不可见。
 *
 * 正交意图：
 *   [1] headless boot：单 dsh-base bundle 全 rows 激活（assertEntriesActivated
 *       typed 抛错，无假成功）；graph 无 web 家族 rows。
 *   [2] 工具面收窄（design D1 负面场景）：disable 的通用工具行不注册
 *       bash/pwsh/read/write/edit/glob/grep/job_* 工具。
 *   [3] 恢复语义：dispose 后二次 boot 达 ready（干净 home 重新 initProfile）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootDshKernel, type DshKernelHandle } from "../src/daemon/kernel/dsh-kernel.js";

let sandbox = "";
const booted: DshKernelHandle[] = [];

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-kernel-test-"));
});

afterEach(async () => {
  for (const instance of booted.splice(0)) {
    await instance.dispose().catch(() => undefined);
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** dsh-base 的 web 家族 rows（bundle 只有 base 时必然缺席；钉死防回归）。 */
const WEB_ROW_NAMES = [
  "@deepseek-ai/dsh-web-app",
  "@deepseek-ai/dsh-web-frontend",
  "@deepseek-ai/dsh-host-webserver",
  "@deepseek-ai/dsh-host-frontend-static",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-modules",
];

/** 内核服务 rows（tasks 2.1 验收 facts）。 */
const KERNEL_SERVICE_ROWS = [
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-session",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-user-approval",
  "@deepseek-ai/dsh-permission-presets",
];

describe("dsh-mcp-client bridge over the kernel (task 4.1b)", () => {
  it(
    "registers skill-creator capability tools on the kernel global tool table",
    { timeout: 240_000 },
    async () => {
      // 形态 A /mcp 端点（真实 WebServer + capability registry）。
      const { createDaemonDomain } = await import("../src/daemon/domain.js");
      const { WebServer } = await import("../src/daemon/web-server.js");
      const { setHomeOverride } = await import("../src/shared/paths.js");
      const { randomBytes } = await import("node:crypto");
      const isolatedHome = path.join(sandbox, "state");
      process.env.SKILL_CREATOR_HOME = isolatedHome;
      setHomeOverride(isolatedHome);
      const domain = createDaemonDomain();
      const webuiDir = path.join(sandbox, "webui");
      fs.mkdirSync(webuiDir, { recursive: true });
      fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html><title>M</title>");
      const token = randomBytes(24).toString("base64url");
      const web = new WebServer({
        webToken: token,
        webuiDir,
        domain,
        status: () => ({
          active: true,
          pid: process.pid,
          version: "test",
          port: 0,
          startedAt: Date.now(),
          tray: "headless",
        }),
      });
      const port = await web.start(0);
      const { createSkillCreatorMcpServer } =
        await import("../src/daemon/mcp/skill-creator-mcp.js");
      web.mountMcp(() =>
        createSkillCreatorMcpServer({
          capabilities: domain.managerCapabilities,
          face: "in-process",
        }),
      );
      try {
        const kernel = await bootDshKernel({
          home: path.join(sandbox, "dsh-home"),
          mcp: { url: `http://127.0.0.1:${port}/mcp`, token },
        });
        booted.push(kernel);
        // dsh-mcp-client 异步连接 + 工具同步：轮询等待 mcp__skill-creator__* 出现。
        let mcpTools: string[] = [];
        for (let attempt = 0; attempt < 30 && mcpTools.length === 0; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          mcpTools = kernel
            .globalToolNames()
            .filter((name) => name.startsWith("mcp__skill-creator__"));
        }
        expect(mcpTools.length).toBeGreaterThan(3);
        expect(mcpTools).toContain("mcp__skill-creator__workspace_list");
        expect(mcpTools).toContain("mcp__skill-creator__skills_list");
        // 角色行（dsh-alpha-native-subagents）：MCP 桥在场时 per-role 官方
        // tool-subagent 行激活——role_* 工具进全局表。裸 delegation 工具
        // （subagent/send_message 等）由基行注册进全局表，但经
        // productToolDenyList 在 agent 层拒绝——产品会话只见本模式角色。
        const globalNames = kernel.globalToolNames();
        for (const slug of ["reviewer", "researcher", "writer"] as const) {
          expect(globalNames).toContain(`role_${slug}`);
        }
        const { productToolDenyList } = await import("../src/daemon/kernel/agent-sessions.js");
        const createDeny = productToolDenyList(globalNames, "create");
        for (const bare of [
          "subagent",
          "subagent_fork",
          "send_message",
          "interrupt_agent",
          "list_agents",
        ]) {
          expect(globalNames).toContain(bare);
          expect(createDeny).toContain(bare);
        }
        expect(createDeny).not.toContain("role_reviewer");
        expect(createDeny).not.toContain("role_writer");
        expect(createDeny).toContain("role_researcher");
        // 收窄不变量保持：通用 fs 工具缺席；平台原生 shell 行（bash@POSIX /
        // pwsh@win32，官方 dsh-base 平台矩阵）是开放模式的例外——行激活，
        // 专注模式经 agent restrict 拒绝（productToolDenyList 单测钉死）。
        const leaked = kernel
          .globalToolNames()
          .filter((name) => ["read", "write", "edit", "glob", "grep"].includes(name));
        expect(leaked).toEqual([]);
        expect(kernel.globalToolNames()).toContain(process.platform === "win32" ? "pwsh" : "bash");
      } finally {
        await web.stop({ graceMs: 0 });
        await domain.repository.dispose();
        await domain.steward.dispose();
        setHomeOverride(null);
      }
    },
  );
});

describe("headless dsh kernel (task 2.1)", () => {
  it(
    "boots the single dsh-base bundle with kernel service rows and no web rows",
    { timeout: 180_000 },
    async () => {
      const kernel = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
      booted.push(kernel);
      const rows = kernel.record.entries.map((entry) => entry.name);
      expect(kernel.record.entries.length).toBeGreaterThan(40);
      for (const serviceRow of KERNEL_SERVICE_ROWS) {
        expect(rows).toContain(serviceRow);
      }
      for (const webRow of WEB_ROW_NAMES) {
        expect(rows).not.toContain(webRow);
      }
      // preset roster row（产品 preset 经 user root 供给；preset 内容的 session 级
      // 验证在 task 2.2/2.3 的 agent 面测试）。
      expect(rows).toContain("@deepseek-ai/dsh-agent-presets");
      expect(kernel.record.activationOrder.length).toBeGreaterThan(0);
    },
  );

  it(
    "keeps the global tool table free of general-purpose fs/shell/web tools except open-mode bash",
    { timeout: 180_000 },
    async () => {
      const kernel = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
      booted.push(kernel);
      const globalTools = kernel.globalToolNames();
      // 平台原生 shell 例外（开放模式原生能力，2026-09-09；平台矩阵 2026-09-25：
      // bash@POSIX / pwsh@win32 互斥——另一侧的名字必须缺席）。
      const nativeShell = process.platform === "win32" ? "pwsh" : "bash";
      const oppositeShell = process.platform === "win32" ? "bash" : "pwsh";
      const forbidden = [
        oppositeShell,
        "read",
        "write",
        "edit",
        "read_image",
        "glob",
        "grep",
        "job_list",
        "job_output",
        "job_kill",
        "web_fetch",
        "web_search",
      ];
      expect(globalTools).toContain(nativeShell);
      const leaked = globalTools.filter((name) => forbidden.includes(name));
      expect(leaked).toEqual([]);
    },
  );

  it(
    "recovers: a second clean-home kernel boot reaches ready after dispose",
    { timeout: 360_000 },
    async () => {
      const first = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
      booted.push(first);
      expect(first.record.entries.length).toBeGreaterThan(0);
      await first.dispose();
      const second = await bootDshKernel({ home: path.join(sandbox, "dsh-home-2") });
      booted.push(second);
      expect(second.record.entries.length).toBeGreaterThan(0);
    },
  );
});
