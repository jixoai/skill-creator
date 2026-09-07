/**
 * DSH headless 内核组合（dsh-kernel-rebase task 2.1）。
 *
 * 用户原始需求 [2026-09-08]：「我需要的是 DSH 的内核。也就是说在现有 skill creator
 * 的基础上。去实现一个 Agent 的产品。」——Skill Creator shell 是唯一宿主；DSH 只作
 * kernel（agent/session/llm/settings/approval/permission），不组 web bundle、不挂
 * HTTP server。
 *
 * 正交意图：
 *   [1] headless boot：官方 profile 机制 + 单 dsh-base bundle + agent-presets
 *       行闭包（persona/ask-user/presentation，dsh-official-profile 头注教训）；
 *       全 rows 激活断言（assertEntriesActivated typed 抛错，无假成功）。
 *   [2] 内核工具面 policy：通用 fs/shell/web 工具 rows 在 user patch 层 disable
 *       （tool-bash/pwsh/fs/fs-search/jobs/web）——产品会话的工具面只能是受控
 *       注册（capability MCP 工具，task 4.1b）+ 显式 allowlist（ask_user_question）。
 *   [3] 探针面：entries/activationOrder/kernel facts（无 port——内核无 HTTP 面）。
 * 妥协声明：disable 列表按行显式声明（不按「非闭包皆删」推断）；web/approval 语义
 *   rows（sandbox/permission/approval）保留——它们是执行策略服务，不注册模型可见
 *   的通用工具。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  boot,
  healProfilesModuleFallback,
  initProfile,
  loadProfile,
  resolveProfileDir,
} from "@deepseek-ai/dsh-app-boot";
import type { Context } from "@deepseek-ai/cordis";
import { completeTransitiveMirror, ensureDirLink } from "../dsh-profile-support.js";

const modulePath = fileURLToPath(import.meta.url);
const sourceMode = path.basename(modulePath) === "dsh-kernel.ts";
/** 源码态 = 仓库根；bundle 态（dist/daemon.js）= 安装包根。 */
const repoRoot = sourceMode
  ? path.resolve(path.dirname(modulePath), "../../..")
  : path.resolve(path.dirname(modulePath), "..");

/**
 * 内核工具面收窄：这些 dsh-base rows 注册模型可见的通用 fs/shell/web 工具，产品
 * 会话一律不可见（design D1）。disable 的是「通用能力行」，不是 sandbox/permission
 * 等执行策略服务。skill-filesystem/tool-skill 同步收窄：宿主机个人 skills 目录的
 * 自动发现注入（system-reminder catalog）越出 Manager 的技能真相边界——技能目录
 * 由 skill-creator-mcp + 提示词最佳实践供给（task 4.x）。
 */
const KERNEL_DISABLED_TOOL_ROWS = [
  "tool-bash",
  "tool-pwsh",
  "tool-fs",
  "tool-fs-search",
  "tool-jobs",
  "tool-web",
  "skill-filesystem",
  "tool-skill",
] as const;

/**
 * 产品会话的显式工具 allowlist（design D1：全局工具表 = capability 注册 + 显式
 * allowlist）。ask_user_question 由 agent-presets 行闭包（dsh-tool-ask-user）在
 * agent 平面供给；capability MCP 工具（mcp__skill-creator__*）由 dsh-mcp-client
 * 行（task 4.1b）注册——后者是 scoped 注册，不进全局 restrict。
 */
export const KERNEL_AGENT_TOOL_ALLOWLIST: readonly string[] = ["ask_user_question"];

/** 内核 boot 记录（无 HTTP 面；facts 供 status.dsh 与测试断言）。 */
export interface DshKernelBootRecord {
  entries: Array<{ id: string; name: string }>;
  activationOrder: string[];
}

/** 运行中的 headless 内核。 */
export interface DshKernelHandle {
  ctx: Context;
  record: DshKernelBootRecord;
  /**
   * 全局工具表的当前名字集合（policy 断言与 agent setup 的 restrict 计算用）。
   * dsh-tools 的 schemas() 返回 scope 可见面；无 scope = 全局视图。
   */
  globalToolNames(): string[];
  /** 有界停止：fiber dispose + 还原 DSH_HOME env。幂等由调用方保证。 */
  dispose(): Promise<void>;
}

export interface DshKernelOptions {
  /** DSH_HOME（调用方负责隔离；profile 与 module fallback 都写在这里）。 */
  home: string;
  /**
   * skill-creator-mcp 连接（task 4.1b）：形态 A 的 /mcp 端点。提供时内核组合
   * dsh-mcp-client 插件行（token 经 env 模板注入，不落盘明文）。
   */
  mcp?: { url: string; token: string };
}

/**
 * 以官方 profile 机制启动 headless 内核（单 dsh-base bundle）。
 * 任何 row 激活失败都会 reject（含 disable 行的依赖服务缺失——出现即说明收窄
 * 列表与官方组合不兼容，必须修收窄列表而不是放宽断言）。
 */
export async function bootDshKernel(options: DshKernelOptions): Promise<DshKernelHandle> {
  // 存储隔离（同 web profile 教训）：storage 单元读 env DSH_HOME，boot 前固定到
  // 本次 home，dispose 恢复原值。
  const previousDshHome = process.env.DSH_HOME;
  process.env.DSH_HOME = options.home;
  const profileDir = resolveProfileDir("kernel", options.home);
  initProfile(profileDir, ["@deepseek-ai/dsh-base"], "startup");
  // mcp 连接配置走 env + 模板引用（README 实测形态）：Authorization 的 Bearer
  // 值不写入 profile YAML（落盘面隔离；env 生命周期与内核一致）。
  const previousMcpUrl = process.env.SKILL_CREATOR_MCP_URL;
  const previousMcpToken = process.env.SKILL_CREATOR_MCP_TOKEN;
  if (options.mcp) {
    process.env.SKILL_CREATOR_MCP_URL = options.mcp.url;
    process.env.SKILL_CREATOR_MCP_TOKEN = options.mcp.token;
  }

  // user patch 层：内核工具面收窄（disable 整行；行 id 来自 dsh-base bundle patch）。
  const disableYaml = KERNEL_DISABLED_TOOL_ROWS.map((id) => `- id: ${id}\n  disabled: true\n`).join(
    "",
  );
  fs.writeFileSync(path.join(profileDir, "cordis.patch.yml"), disableYaml, "utf8");

  const installAnchor = path.join(repoRoot, "package.json");
  const profile = loadProfile("skill-creator", "kernel", installAnchor, options.home);
  await healProfilesModuleFallback({ installAnchor, profile, home: options.home });
  completeTransitiveMirror(options.home);

  // 产品 preset（roster 的 user root：$DSH_HOME/.agent-presets/<id>/，官方机制
  // includeUserRoot）：persona + ask-user，不含任何 bash/fs/web/skill/subagent
  // 工具行——产品会话的领域工具面只经 skill-creator-mcp（task 4.1b）。官方
  // standard/minimal presets 的工具行因此对产品会话不存在（preset 即 agent
  // plane 组合，restrict 管不到 scoped 注册，故必须在 preset 层面收窄）。
  const presetDir = path.join(options.home, ".agent-presets", "skill-creator");
  fs.mkdirSync(presetDir, { recursive: true });
  fs.writeFileSync(
    path.join(presetDir, "preset.yml"),
    [
      "name: Skill Creator Agent",
      "description: 产品会话预设——Manager 能力面 + ask-user，无通用 fs/shell 工具。",
      "order: 1",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(presetDir, "agent.cordis.yml"),
    [
      "# skill-creator 产品 preset：由 skill-creator kernel boot 写入（user root）。",
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config:",
      "    text: >-",
      "      You are the Skill Creator agent embedded in the Skill Creator app.",
      "      You manage skills through the skill-creator MCP tools; filesystem and",
      "      shell access are not part of this product session.",
      "",
      "- id: tool-ask-user",
      "  name: '@deepseek-ai/dsh-tool-ask-user'",
      "",
    ].join("\n"),
    "utf8",
  );

  // entry rows：agent-presets roster（default 指向产品 preset）+ workspace
  // （session 归属的 workspaceRegistry 服务；dsh-base 不含此行，binder 绑定
  // 依赖它）。preset 行引用的 persona/ask-user 包不在 dsh-base 闭包内，由本仓
  // dependencies 经 heal 镜像供给（dsh-official-profile 头注教训，2026-09-06 实测）。
  const configPath = path.join(profileDir, "cordis.yml");
  const mcpRow = options.mcp
    ? [
        "- id: mcp-skill-creator\n",
        "  name: '@deepseek-ai/dsh-mcp-client'\n",
        "  config:\n",
        "    serverName: skill-creator\n",
        "    transport: streamable-http\n",
        "    url: !!js process.env.SKILL_CREATOR_MCP_URL\n",
        "    headers:\n",
        "      Authorization: !!js '`Bearer ${process.env.SKILL_CREATOR_MCP_TOKEN}`'\n",
      ].join("")
    : "";
  fs.writeFileSync(
    configPath,
    [
      "- id: agent-presets\n",
      "  name: '@deepseek-ai/dsh-agent-presets'\n",
      "  config:\n",
      "    default: skill-creator\n",
      "    includeShippedRoot: false\n",
      "- id: workspace\n",
      "  name: '@deepseek-ai/dsh-workspace'\n",
      mcpRow,
    ].join(""),
    "utf8",
  );
  // preset 闭包三包经 heal 的根 dependencies 遍历自动镜像（同 web profile 机制）。

  const patches = [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches];
  const constructed: Array<{ options: { id: string; name: string } }> = [];
  const prepare = (ctx: Context): void => {
    // appExit 不能 process.exit（宿主进程内嵌），转为异常；内核无 web-startup，
    // 不提供 cmdlineArgs。
    ctx.provide("appExit", (code?: number) => {
      throw new Error(`kernel profile requested app exit (${code ?? 0})`);
    });
    (
      ctx as unknown as {
        on: (
          event: "loader/entry-init",
          listener: (entry: { options: { id: string; name: string } }) => void,
        ) => () => void;
      }
    ).on("loader/entry-init", (entry) => {
      constructed.push(entry);
    });
  };
  const ctx = await boot(
    "skill-creator",
    configPath,
    patches,
    prepare,
    new URL(".", import.meta.url).href,
  );

  const treeEntries: Array<{ id: string; name: string }> = [];
  for (const entry of (
    ctx as Context & {
      loader?: { entries: () => Iterable<{ id: string; options: { name: string } }> };
    }
  ).loader?.entries() ?? []) {
    treeEntries.push({ id: entry.id, name: entry.options.name });
  }
  const record: DshKernelBootRecord = {
    entries: treeEntries,
    activationOrder: constructed.map((entry) => entry.options.name),
  };

  const toolsRuntime = (
    ctx as Context & {
      tools?: { schemas?: () => Array<{ name?: string }> };
    }
  ).tools;
  const globalToolNames = (): string[] => {
    const schemas = toolsRuntime?.schemas?.() ?? [];
    return schemas
      .map((schema) => schema?.name)
      .filter((name): name is string => typeof name === "string");
  };

  return {
    ctx,
    record,
    globalToolNames,
    dispose: async () => {
      await (ctx as unknown as { fiber?: { dispose: () => Promise<void> } }).fiber?.dispose();
      if (previousDshHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previousDshHome;
      restoreEnv("SKILL_CREATOR_MCP_URL", previousMcpUrl);
      restoreEnv("SKILL_CREATOR_MCP_TOKEN", previousMcpToken);
    },
  };
}

/** env 还原（undefined = 原本不存在，删除）。 */
function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}
