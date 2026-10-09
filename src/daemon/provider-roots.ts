/**
 * 用户原始需求 [2026-07-22]：「home 目录定义为 GlobalWorkspace；一个 Workspace 下可以包含多个 providers。」
 * 正交意图：
 *   [1] 按社区 catalog 解析 Global Provider 的实际 skills 根目录。
 *   [2] 从 Imported Workspace 根目录安全派生 Provider 的 project skills 根目录。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { providerCatalogEntry, type ProviderCatalogEntry } from "../shared/provider-catalog.js";
import { homeDir } from "../shared/paths.js";
import type { ProviderId } from "../shared/contracts/workspaces.js";
import { DomainError } from "./domain-error.js";

/** Resolve a known Provider ID or reject an untrusted transport value. */
export function requireProvider(providerId: ProviderId): ProviderCatalogEntry {
  const provider = providerCatalogEntry(providerId);
  if (!provider) throw new DomainError("NOT_FOUND", `Provider not found: ${providerId}`);
  return provider;
}

/**
 * Resolve one global Agent skills root following the community catalog's environment overrides.
 * `home` 允许注入宿主 homeDir()（creator-skill-store 批 1：global 应用的投影根必须
 * 与内核 global scopeBase（userDir = 宿主 homeDir）同源。缺省 os.homedir()：
 * global agent roots 是「用户家」语义（测试套以 HOME 隔离、SKILL_CREATOR_HOME
 * 只隔离应用状态——双 home 是故意设计）；dev 隔离由启动器统一设 HOME 承担
 * （scripts/dev.sh.ts 批 3 修正），不在本函数合并两个语义。
 */
export function globalProviderRoot(
  provider: ProviderCatalogEntry,
  home = os.homedir(),
): string | null {
  if (provider.globalPath === null) return null;
  const override = globalHomeOverride(provider.id);
  if (override) return path.join(override, "skills");
  if (provider.id === "openclaw") return openClawRoot(home);
  if (provider.globalPath.startsWith(".config/")) {
    const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config");
    return path.join(configHome, provider.globalPath.slice(".config/".length));
  }
  return path.join(home, provider.globalPath);
}

/** Resolve a provider root under an Imported Workspace without accepting caller paths. */
export function importedProviderRoot(
  workspaceRoot: string,
  provider: ProviderCatalogEntry,
): string {
  const root = path.resolve(workspaceRoot, provider.workspacePath);
  const relative = path.relative(workspaceRoot, root);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Provider root escaped Workspace: ${provider.id}`);
  }
  return root;
}

/** Return whether a provider root currently exists as a directory. */
export function providerRootAvailable(root: string | null): boolean {
  if (!root) return false;
  try {
    return fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

function globalHomeOverride(providerId: string): string | null {
  const variable =
    providerId === "codex"
      ? "CODEX_HOME"
      : providerId === "claude-code"
        ? "CLAUDE_CONFIG_DIR"
        : providerId === "mistral-vibe"
          ? "VIBE_HOME"
          : providerId === "hermes-agent"
            ? "HERMES_HOME"
            : providerId === "autohand-code"
              ? "AUTOHAND_HOME"
              : providerId === "grok"
                ? "GROK_HOME"
                : null;
  const value = variable ? process.env[variable]?.trim() : undefined;
  return value || null;
}

function openClawRoot(home: string): string {
  for (const directory of [".openclaw", ".clawdbot", ".moltbot"]) {
    if (providerRootAvailable(path.join(home, directory)))
      return path.join(home, directory, "skills");
  }
  return path.join(home, ".openclaw", "skills");
}
