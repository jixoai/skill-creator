/**
 * 正交意图（2026-09-17）
 * 用户原始需求：「性能脚本：1k/10k/50k 构建/体积/延迟测量（手动跑，结果记 docs/search-design.md §11）。」
 * 1. 以生产引擎配置（真 SkillTokenizer + 字段/boost/fuzzy/prefix 常量）测合成语料的构建耗时与索引 JSON 体积。
 * 2. 测搜索延迟分布（p50/p95 多轮）与单文档增量更新（discard+add）成本。
 * 运行：`bun scripts/search-perf.sh.ts`（手动工具，不进回归门；结果人工回填 docs）。
 */
import { createHash } from "node:crypto";
import {
  createSearchMiniSearch,
  minisearchRuntimeVersion,
} from "../src/daemon/skill-search/index.js";
import { createSkillTokenizer } from "../src/daemon/skill-search/tokenizer.js";
import type { SkillSearchDocument } from "../src/shared/contracts/search.js";
import { SkillIdSchema } from "../src/shared/contracts/skills.js";
import { ProviderIdSchema } from "../src/shared/contracts/workspaces.js";

const EN_TOPICS = [
  "react",
  "svelte",
  "typescript",
  "css animation",
  "git workflow",
  "cloudflare workers",
  "database indexing",
  "api design",
  "testing pyramid",
  "accessibility",
  "performance budget",
  "state management",
  "router",
  "form validation",
  "i18n",
  "build pipeline",
  "code review",
  "design tokens",
  "websocket",
  "queue workers",
];
const ZH_TOPICS = [
  "组件设计",
  "类型安全",
  "渲染优化",
  "路由管理",
  "状态管理",
  "测试策略",
  "构建工具",
  "代码审查",
  "动画系统",
  "无障碍访问",
  "性能监控",
  "数据缓存",
  "表单校验",
  "国际化",
  "部署流程",
  "错误处理",
  "日志系统",
  "权限模型",
  "搜索索引",
  "文档生成",
];

const pick = (items: readonly string[], index: number): string => items[index % items.length];

function bodyGen(index: number): string {
  const parts: string[] = [];
  for (let section = 0; section < 12; section += 1) {
    const en = `${pick(EN_TOPICS, index + section)} guide section ${section} with identifiers like camelCaseValue, kebab-case-name, @scope/pkg-name and http3 notes.`;
    const zh = `第${section}节：${pick(ZH_TOPICS, index + section)}的最佳实践，中英混排 token，例如组件设计模式与渲染管线优化。`;
    parts.push(section % 2 ? zh : en);
  }
  return parts.join(" ");
}

function makeDocument(index: number): SkillSearchDocument {
  const name = `${pick(EN_TOPICS, index).replace(/\s+/g, "-")}-${pick(ZH_TOPICS, index)}-${index}`;
  const canonicalPath = `/perf-corpus/${name}`;
  return {
    id: SkillIdSchema.parse(
      `sk_${createHash("sha256").update(canonicalPath).digest("hex").slice(0, 24)}`,
    ),
    name,
    description: `${pick(EN_TOPICS, index)} and ${pick(ZH_TOPICS, index)} skill #${index}: production guidance, checklists and code review heuristics.`,
    keywords: [pick(EN_TOPICS, index), `kw-${index % 97}`],
    triggers: [],
    headings: `${pick(EN_TOPICS, index)} overview; ${pick(ZH_TOPICS, index)} 实践; troubleshooting`,
    body: bodyGen(index),
    canonicalPath,
    installations: [
      {
        path: `/root/${name}`,
        workspaceId: "~",
        providerId: ProviderIdSchema.parse("claude-code"),
      },
    ],
    contentHash: createHash("sha256").update(String(index)).digest("hex"),
    disabled: false,
    conflict: false,
    invalidFrontmatter: false,
  };
}

const LATENCY_QUERIES = [
  "react component design",
  "React 组件设计",
  "类型安全 typescript",
  "cloudflare workers deploy",
  "动画 animation",
  "@scope/pkg-name",
  "性能 performance budget",
  "i18n 国际化",
];

interface Latency {
  p50: number;
  p95: number;
  mean: number;
}

function measureSearchLatency(search: (query: string) => number, rounds: number): Latency {
  const samples: number[] = [];
  for (let i = 0; i < rounds; i += 1) {
    const query = LATENCY_QUERIES[i % LATENCY_QUERIES.length];
    const started = performance.now();
    search(query);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  return {
    p50: samples[Math.floor(samples.length / 2)],
    p95: samples[Math.floor(samples.length * 0.95)],
    mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
  };
}

function forceGc(): void {
  const globals = globalThis as { gc?: () => void };
  globals.gc?.();
}

function run(scale: number): void {
  const documents = Array.from({ length: scale }, (_, index) => makeDocument(index));
  const tokenizer = createSkillTokenizer();
  forceGc();
  const heapBefore = process.memoryUsage().heapUsed;
  const miniSearch = createSearchMiniSearch(tokenizer);
  const buildStarted = performance.now();
  miniSearch.addAll(documents);
  const buildMs = performance.now() - buildStarted;
  const heapAfter = process.memoryUsage().heapUsed;
  const jsonBytes = JSON.stringify(miniSearch.toJSON()).length;

  const searchOne = (query: string): number => {
    const results = miniSearch.search(query, {
      boost: { name: 10, description: 6, keywords: 5, triggers: 5, headings: 3, body: 1 },
      prefix: true,
      fuzzy: 0.2,
    });
    return results.length;
  };
  const latency = measureSearchLatency(searchOne, 40);

  const updateStarted = performance.now();
  const first = documents[0];
  if (!first) throw new Error("perf corpus must not be empty");
  miniSearch.discard(first.id);
  miniSearch.add({ ...first, description: `${first.description} updated` });
  const updateMs = performance.now() - updateStarted;

  console.log(
    `${String(scale).padStart(6)} docs | build ${buildMs.toFixed(0).padStart(6)}ms | json ${(jsonBytes / 1e6).toFixed(1).padStart(6)}MB | heapΔ ${((heapAfter - heapBefore) / 1e6).toFixed(0).padStart(5)}MB | search p50/p95 ${latency.p50.toFixed(1)}/${latency.p95.toFixed(1)}ms | update1 ${updateMs.toFixed(2)}ms`,
  );
}

console.log(
  `minisearch ${minisearchRuntimeVersion()} | node ${process.version} | ${process.platform}-${process.arch}`,
);
for (const scale of [1_000, 10_000, 50_000]) run(scale);
