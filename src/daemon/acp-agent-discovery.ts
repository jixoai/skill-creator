/**
 * 原始需求 [2026-07-27]：「FULL 多 agent 支持……探测用户机器上已安装的 ACP-capable agent（claude、codex、gemini、goose、opencode、qwen-code、kimi-cli、kiro-cli 等），缓存到 daemon 生命周期内。」
 * 正交意图：
 *   [1] 用稳定的 KNOWN_ACP_AGENTS 表达本机已知 ACP-capable agent 的 id/label/vendor/binary。
 *   [2] 用 `which`/`where` 探测 PATH 解析出绝对二进制路径，结果含 `available` 标记并缓存到 daemon 生命周期内。
 *   [3] 探测失败的条目降级为 `available: false`，不抛错、不阻塞其它 agent。
 * 妥协声明：探测结果缓存到 daemon 生命周期；用户新装 agent 需重启 daemon 才被识别（D2 有意的简单性）。
 */
import { execa } from "execa";
import { AcpAgentIdSchema, type AcpAgentId, type AcpAgentInfo } from "../shared/contracts/acp.js";

/** 一条已知 ACP-capable agent 的静态注册项。 */
export interface KnownAcpAgent {
  /** 稳定 agent 标识。 */
  readonly id: string;
  /** 面向用户的展示名。 */
  readonly label: string;
  /** 厂商标签。 */
  readonly vendor: string;
  /** PATH 中查找的二进制名。 */
  readonly binary: string;
  /** spawn 时附加的 ACP 启用 flag（多数 agent 用 `--acp`）。 */
  readonly acpFlag: string;
}

/**
 * 本机已知的 ACP-capable agent 注册表。
 * 新增 agent 时在此追加一行；id 与 binary 一一对应。
 */
export const KNOWN_ACP_AGENTS: readonly KnownAcpAgent[] = [
  { id: "claude", label: "Claude Code", vendor: "anthropic", binary: "claude", acpFlag: "--acp" },
  { id: "codex", label: "Codex", vendor: "openai", binary: "codex", acpFlag: "--acp" },
  { id: "gemini", label: "Gemini CLI", vendor: "google", binary: "gemini", acpFlag: "--acp" },
  { id: "goose", label: "Goose", vendor: "block", binary: "goose", acpFlag: "--acp" },
  { id: "opencode", label: "opencode", vendor: "sst", binary: "opencode", acpFlag: "--acp" },
  { id: "qwen-code", label: "Qwen Code", vendor: "alibaba", binary: "qwen-code", acpFlag: "--acp" },
  { id: "kimi-cli", label: "Kimi CLI", vendor: "moonshot", binary: "kimi-cli", acpFlag: "--acp" },
  { id: "kiro-cli", label: "Kiro CLI", vendor: "aws", binary: "kiro-cli", acpFlag: "--acp" },
];

/** `which`/`where` 探测适配器；返回绝对二进制路径，未找到时 reject。 */
export type BinaryResolver = (binary: string) => Promise<string>;

/** 探测模块依赖注入；默认走真实 execa（跨平台 `which`/`where`）。 */
export interface AcpAgentDiscoveryOptions {
  /** 可替换的二进制解析器；默认 shell out `which`/`where`。 */
  resolveBinary?: BinaryResolver;
}

const DEFAULT_TIMEOUT_MS = 3_000;

/** 默认二进制解析：win32 用 `where`，其它平台用 `which`；未找到 reject。 */
async function resolveBinaryWithWhich(binary: string): Promise<string> {
  const command = process.platform === "win32" ? "where" : "which";
  const result = await execa(command, [binary], {
    timeout: DEFAULT_TIMEOUT_MS,
    reject: true,
  });
  // `which`/`where` 的首行 stdout 即绝对二进制路径。
  const firstLine = result.stdout.split("\n", 1)[0]?.trim();
  if (!firstLine) throw new Error(`${command} returned empty path for ${binary}`);
  return firstLine;
}

/**
 * 创建一个 daemon 生命周期内的 ACP agent 探测器。
 *
 * - `list()`：首次调用探测全部 KNOWN_ACP_AGENTS，结果缓存；后续命中缓存。
 * - `lookup(id)`：返回缓存中的单条 agent（含 binaryPath/acpFlag），未装或未知返回 null。
 * 探测失败的条目降级为 `available: false`，不抛错。
 */
export function createAcpAgentDiscovery(options: AcpAgentDiscoveryOptions = {}): AcpAgentDiscovery {
  const resolveBinary = options.resolveBinary ?? resolveBinaryWithWhich;
  let cached: AcpAgentInfo[] | null = null;
  const pathById = new Map<string, string>();
  const knownById = new Map(KNOWN_ACP_AGENTS.map((agent) => [agent.id, agent]));

  const probeOnce = async (): Promise<AcpAgentInfo[]> => {
    const results = await Promise.all(
      KNOWN_ACP_AGENTS.map(async (agent): Promise<AcpAgentInfo> => {
        try {
          const binaryPath = await resolveBinary(agent.binary);
          pathById.set(agent.id, binaryPath);
          return {
            id: AcpAgentIdSchema.parse(agent.id),
            label: agent.label,
            vendor: agent.vendor,
            binaryPath,
            available: true,
          };
        } catch {
          // 二进制缺失 / which 失败 → available: false，不抛错。
          return {
            id: AcpAgentIdSchema.parse(agent.id),
            label: agent.label,
            vendor: agent.vendor,
            binaryPath: "",
            available: false,
          };
        }
      }),
    );
    return results;
  };

  return {
    /** 返回缓存的 agent 列表；首次调用探测，后续命中缓存。 */
    async list(): Promise<AcpAgentInfo[]> {
      if (cached) return cached;
      cached = await probeOnce();
      return cached;
    },
    /** 返回已解析的 agent 注册项（含 binaryPath/acpFlag）；未安装或未知返回 null。 */
    lookup(id: AcpAgentId): (KnownAcpAgent & { binaryPath: string; available: boolean }) | null {
      const known = knownById.get(id);
      if (!known) return null;
      const binaryPath = pathById.get(id) ?? "";
      return { ...known, binaryPath, available: binaryPath !== "" };
    },
  };
}

/** ACP agent 探测器实例接口。 */
export interface AcpAgentDiscovery {
  /** 返回缓存的 agent 列表；首次调用探测，后续命中缓存。 */
  list(): Promise<AcpAgentInfo[]>;
  /** 返回已解析的 agent 注册项（含 binaryPath/acpFlag）；未安装或未知返回 null。 */
  lookup(id: AcpAgentId): (KnownAcpAgent & { binaryPath: string; available: boolean }) | null;
}
