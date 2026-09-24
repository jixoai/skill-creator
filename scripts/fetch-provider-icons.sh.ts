/**
 * 抓取 provider 图标生成静态 map（openspec add-agent-settings-modes 迭代五；
 * settings-panel-zcode-source 改源：provider 清单从 pi-ai 目录改为 zcode
 * Registry 生成物——pi-ai 目录随 models.dev 模型镜像退役）。
 *
 * 用户原始需求 [2026-09-12]：「缺少模型供应商的图标……你自己混合处理一下，
 * models.dev 这里有」+ 图标端点规律 `https://models.dev/logos/{provider}.svg`。
 * 用户裁决 [2026-09-25]：models.dev 仅作静态 logo 资产源（shufa-server 同
 * 口径）；模型目录数据源 = zcode Registry（extract-zcode-presets.sh.ts）。
 *
 * 正交意图：
 *   [1] 一次抓取：按 zcodePresets provider 列表（含 ALIASES 兜底）拉取 svg，
 *       内联为 dataURL 写 src/shared/provider-icons.generated.ts（产物入库，
 *       产品运行时零网络依赖；本脚本仅手动刷新）。
 *   [2] 占位识别：该端点对未知 id 返回统一占位 svg（HTTP 200），以两个 bogus
 *       样本的内容哈希为基准，命中占位即视为无图标（UI 字母头像回退）。
 * 妥协声明：无图标 provider 回退字母头像（混合处理的另一半）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LOGO_BASE = "https://models.dev/logos";

/** 跨族/变体别名（provider id → models.dev logo slug；键含 pi-ai 时代
 *  遗留 id，zcode id 未命中时自然跳过，刷新时可按需修剪）。 */
const ALIASES: Record<string, string> = {
  "zai-coding-cn": "zai",
  "kimi-coding": "moonshotai",
  "openai-codex": "openai",
  "azure-openai-responses": "azure",
  "qwen-token-plan": "alibaba-token-plan",
  "qwen-token-plan-cn": "alibaba-token-plan",
  "qwen-token-plan-individual": "alibaba-token-plan",
  "vercel-ai-gateway": "vercel",
};

/** zcode Registry provider 列表（与 src/daemon/model-catalog.ts 同一生成物）。 */
async function ourProviderIds(): Promise<string[]> {
  const { pathToFileURL } = await import("node:url");
  const mod = (await import(
    pathToFileURL(path.resolve(import.meta.dirname, "../src/daemon/zcode-presets.ts")).href
  )) as { zcodePresets: ReadonlyArray<{ provider: string }> };
  return [...new Set(mod.zcodePresets.map((p) => p.provider))];
}

async function fetchSvg(id: string): Promise<string | null> {
  try {
    const res = await fetch(`${LOGO_BASE}/${id}.svg`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// 占位基准：两个 bogus id 的响应哈希应一致；据此识别未知 provider。
const [bogusA, bogusB] = await Promise.all([
  fetchSvg("zzz-not-a-provider-a"),
  fetchSvg("zzz-not-a-provider-b"),
]);
const placeholderHashes = new Set(
  [bogusA, bogusB]
    .filter((svg): svg is string => svg !== null)
    .map((svg) => createHash("sha256").update(svg).digest("hex")),
);
const isPlaceholder = (svg: string): boolean =>
  placeholderHashes.has(createHash("sha256").update(svg).digest("hex"));

const ids = await ourProviderIds();
const candidatesFor = (id: string): string[] => [
  id,
  ...(id.endsWith("-cn") ? [id.slice(0, -3)] : []),
  ...(ALIASES[id] ? [ALIASES[id]!] : []),
];

const entries: Array<[string, string]> = [];
const missing: string[] = [];
for (const id of ids) {
  let matched: string | null = null;
  let svg: string | null = null;
  for (const candidate of candidatesFor(id)) {
    const fetched = await fetchSvg(candidate);
    if (fetched !== null && !isPlaceholder(fetched)) {
      matched = candidate;
      svg = fetched;
      break;
    }
  }
  if (svg === null) {
    missing.push(id);
    continue;
  }
  entries.push([id, `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`]);
  console.log(`✓ ${id}${matched !== id ? ` (→ ${matched})` : ""}`);
}
for (const id of missing) console.log(`✗ ${id} (letter-avatar fallback)`);

const header = `/**
 * provider 图标 map（scripts/fetch-provider-icons.sh.ts 生成，2026-09-12）。
 * 数据源：https://models.dev/logos/<provider>.svg（内联 dataURL）。
 * 无图标的 provider 由 UI 字母头像回退；刷新请重跑脚本后提交。
 * browser-safe：纯常量。
 */
`;
const body = `export const PROVIDER_ICONS: Readonly<Record<string, string>> = {\n${entries
  .map(([id, url]) => `  ${JSON.stringify(id)}: ${JSON.stringify(url)},\n`)
  .join("")}};\n`;
const target = path.resolve(import.meta.dirname, "../src/shared/provider-icons.generated.ts");
fs.writeFileSync(target, header + body);
console.log(`\nwrote ${entries.length} icons → ${target} (${missing.length} fallback)`);
