/**
 * 模型 provider 目录服务（openspec add-agent-settings-modes 迭代四）。
 *
 * 用户原始需求 [2026-09-11]：「直接基于 models.generated.js 去提供可用提供商
 * （记住提供 filter）……每个小卡片显示 icon、title、url 这些基本信息。」
 *
 * 数据源 = pi-ai 装配目录（models.dev 的生成镜像；dist/providers/data/*.json 与
 * models.generated.js 同源）。经 dsh-base 包树 resolve（pi-ai 非 root 直接依赖，
 * exports 亦不暴露 models 子路径），fs 读 JSON —— 与内核运行时同一份目录事实。
 *
 * 正交意图：
 *   [1] 投影：provider → {label(known 覆写/美化), api, baseURL, models[{id,name,image}]}；
 *       重点 provider 置顶，其余字母序；排除内部 faux。
 *   [2] 单次加载缓存（目录随包版本变化，进程内不变）。
 * 妥协声明：resolve 失败返回 typed UNAVAILABLE——不静默空目录。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { ModelProviderCatalogEntry } from "../shared/contracts/dsh-runtime.js";
import { PROVIDER_ICONS } from "../shared/provider-icons.generated.js";
import { DomainError } from "./domain-error.js";

/** 重点 provider 置顶顺序 + 显示名覆写（2026-09-11 用户点名）。 */
const KNOWN_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["zai-coding-cn", "Z.ai (智谱)"],
  ["zai", "Z.ai"],
  ["moonshotai-cn", "Kimi (月之暗面)"],
  ["moonshotai", "Kimi"],
  ["deepseek", "DeepSeek"],
  ["minimax-cn", "MiniMax"],
  ["minimax", "MiniMax (Global)"],
  ["qwen-token-plan-cn", "阿里云百炼"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["google", "Google Gemini"],
];

/** 内部/测试路由，不进画廊。 */
const EXCLUDED_PROVIDERS = new Set(["faux"]);

/** provider id → 显示名（known 覆写或 - 分词美化；-cn 后缀标注）。 */
function labelOf(provider: string): string {
  for (const [id, label] of KNOWN_LABELS) {
    if (id === provider) return label;
  }
  const cn = provider.endsWith("-cn");
  const base = cn ? provider.slice(0, -3) : provider;
  const pretty = base
    .split(/[-_]/)
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
  return cn ? `${pretty} · CN` : pretty;
}

/** 解析 pi-ai data 目录（dsh-base 包树 → dsh-llm-pi-ai → pi-ai；pnpm store 布局）。 */
function resolveCatalogDataDir(): string {
  const require = createRequire(import.meta.url);
  const basePkg = require.resolve("@deepseek-ai/dsh-base/package.json");
  // basePkg = <store>/<pkg>/node_modules/@deepseek-ai/dsh-base/package.json；
  // dsh-base 的依赖挂在其 store 单元的 node_modules/（basePkg 上三级）。
  const baseNm = path.dirname(path.dirname(path.dirname(basePkg)));
  const hostReal = fs.realpathSync(path.join(baseNm, "@deepseek-ai/dsh-llm-pi-ai"));
  // hostReal = <store2>/<pkg2>/node_modules/@deepseek-ai/dsh-llm-pi-ai；
  // 其依赖在同单元 node_modules/ 下（@deepseek-ai 的兄弟目录）。
  const piAi = path.join(path.dirname(hostReal), "../@earendil-works/pi-ai");
  const dataDir = path.join(piAi, "dist", "providers", "data");
  if (!fs.existsSync(dataDir)) {
    throw new DomainError("UNAVAILABLE", `pi-ai catalog data not found at ${dataDir}`);
  }
  return dataDir;
}

/** 单条目录 JSON 的 runtime 收窄：{ [api]: { [modelId]: model } }。 */
function parseCatalogFile(raw: unknown): Array<{
  id: string;
  name?: string;
  api: string;
  baseUrl?: string;
  contextWindow?: number;
  input?: unknown;
}> {
  if (typeof raw !== "object" || raw === null) return [];
  const models: Array<{
    id: string;
    name?: string;
    api: string;
    baseUrl?: string;
    contextWindow?: number;
    input?: unknown;
  }> = [];
  for (const byApi of Object.values(raw as Record<string, unknown>)) {
    if (typeof byApi !== "object" || byApi === null) continue;
    for (const model of Object.values(byApi as Record<string, unknown>)) {
      if (typeof model !== "object" || model === null) continue;
      const m = model as {
        id?: unknown;
        name?: unknown;
        api?: unknown;
        baseUrl?: unknown;
        contextWindow?: unknown;
        input?: unknown;
      };
      if (typeof m.id !== "string" || typeof m.api !== "string") continue;
      models.push({
        id: m.id,
        name: typeof m.name === "string" ? m.name : undefined,
        api: m.api,
        baseUrl: typeof m.baseUrl === "string" ? m.baseUrl : undefined,
        contextWindow:
          typeof m.contextWindow === "number" &&
          Number.isInteger(m.contextWindow) &&
          m.contextWindow > 0
            ? m.contextWindow
            : undefined,
        input: m.input,
      });
    }
  }
  return models;
}

/** 目录投影缓存（进程内一次）。 */
let cached: ModelProviderCatalogEntry[] | null = null;

/** 全量 provider 目录（重点置顶，其余字母序）。 */
export function listModelProviders(): ModelProviderCatalogEntry[] {
  if (cached !== null) return cached;
  const dataDir = resolveCatalogDataDir();
  const entries: ModelProviderCatalogEntry[] = [];
  for (const file of fs.readdirSync(dataDir)) {
    if (!file.endsWith(".json")) continue;
    const provider = file.slice(0, -".json".length);
    if (EXCLUDED_PROVIDERS.has(provider)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
    } catch {
      continue; // 损坏条目丢弃（集合读取法则）。
    }
    const models = parseCatalogFile(parsed);
    if (models.length === 0) continue;
    const api = models[0]!.api;
    const baseURL = models.find((model) => model.baseUrl)?.baseUrl;
    if (baseURL === undefined) continue;
    entries.push({
      provider,
      label: labelOf(provider),
      api,
      baseURL,
      icon: PROVIDER_ICONS[provider] ?? null,
      models: models.map((model) => ({
        id: model.id,
        ...(model.name ? { name: model.name } : {}),
        image: Array.isArray(model.input) && model.input.includes("image"),
        ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      })),
    });
  }
  const rank = new Map(KNOWN_LABELS.map(([id], index) => [id, index]));
  entries.sort((a, b) => {
    const ra = rank.get(a.provider) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.provider) ?? Number.MAX_SAFE_INTEGER;
    return ra !== rb ? ra - rb : a.label.localeCompare(b.label);
  });
  cached = entries;
  return entries;
}

/** 服务面（domain 装配用）。 */
export function createModelCatalogService() {
  return {
    /** 全量目录（resolve/读盘失败 typed UNAVAILABLE）。 */
    list(): ModelProviderCatalogEntry[] {
      return listModelProviders();
    },
  };
}

export type ModelCatalogService = ReturnType<typeof createModelCatalogService>;
