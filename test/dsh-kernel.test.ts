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
    "keeps the global tool table free of general-purpose fs/shell/web tools (design D1)",
    { timeout: 180_000 },
    async () => {
      const kernel = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
      booted.push(kernel);
      const globalTools = kernel.globalToolNames();
      const forbidden = [
        "bash",
        "pwsh",
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
