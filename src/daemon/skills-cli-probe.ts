/**
 * skills-CLI 兼容探测：shell out `npx skills list --json` 并投影为 path→provenance 映射。
 *
 * 用户原始需求 [2026-07-27]：「自动区分经 npx-skills-cli 安装的技能；缺 npx/无网络/无 token 时静默降级。」
 * 正交意图：
 *   [1] 把 `npx skills list --json` 的 stdout 当作不可信外部输入解析为 path→技能摘要映射。
 *   [2] 在 daemon 生命周期内缓存探测结果，并允许 update-check/apply 成功后失效。
 * 妥协声明：探测有 npx 冷启动成本；按 D6，结果缓存到 daemon 生命周期内，不在每次 `skills.list` RPC 时重跑。
 */
import { execa } from "execa";
import { z } from "zod";
import { safeParseJson } from "../shared/external-input.js";

/** `npx skills list --json` 单条输出的最小可消费子集；多余字段被忽略。 */
const SkillsCliListEntrySchema = z.object({
  /** 技能名。 */
  name: z.string(),
  /** 技能的规范路径（canonicalPath）。 */
  path: z.string().min(1),
  /** 作用域；CLI 输出为 `project` 或 `global`，额外值被丢弃。 */
  scope: z.union([z.literal("project"), z.literal("global")]).optional(),
});

/** 数组的宽松外壳：只校验「是数组」，逐条目单独 safeParse 后丢弃坏条目。 */
const SkillsCliListEnvelopeSchema = z.array(z.unknown());

/** 一条经 safeParse 后的 skills-CLI 探测条目。 */
export type SkillsCliProbeEntry = {
  name: string;
  path: string;
  scope: "project" | "global" | undefined;
};

/** 探测结果：技能规范路径 → 摘要条目。 */
export type SkillsCliProbeMap = ReadonlyMap<string, SkillsCliProbeEntry>;

/** 子进程适配器；测试可注入 mock，失败时必须 reject。 */
export type SkillsCliRunner = () => Promise<{ stdout: string }>;

/** 探测模块依赖注入；默认走真实 execa。 */
export interface SkillsCliProbeOptions {
  /** 可替换的子进程执行器；默认 shell out `npx skills list --json`。 */
  run?: SkillsCliRunner;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** 默认子进程执行：`npx skills list --json`，失败 reject。 */
async function runNpxSkillsList(): Promise<{ stdout: string }> {
  return execa("npx", ["skills", "list", "--json"], {
    timeout: DEFAULT_TIMEOUT_MS,
    reject: true,
  });
}

/**
 * 把 skills-CLI 的 stdout 当作不可信 JSON 解析为映射。
 *
 * 整体结构不兼容（非 JSON / 非数组）→ 空映射；数组中的单条目缺字段或类型不符 →
 * 仅丢弃该坏条目，保留其余合法条目。绝不抛错。
 */
export function parseSkillsCliList(stdout: unknown): SkillsCliProbeMap {
  const raw = typeof stdout === "string" ? stdout : "";
  const envelope = safeParseJson(raw, SkillsCliListEnvelopeSchema);
  if (!envelope) return new Map();
  const map = new Map<string, SkillsCliProbeEntry>();
  for (const item of envelope) {
    const entry = SkillsCliListEntrySchema.safeParse(item);
    if (!entry.success) continue;
    map.set(entry.data.path, {
      name: entry.data.name,
      path: entry.data.path,
      scope: entry.data.scope,
    });
  }
  return map;
}

/**
 * 创建一个 daemon 生命周期内的 skills-CLI 探测器。
 *
 * - `probe()`：shell out 一次（失败降级为空映射），结果缓存到模块实例；
 *   重复调用直接返回缓存。
 * - `invalidate(paths?)`：update-check/apply 成功后失效指定路径或全部缓存，
 *   下次 `probe()` 会重新 shell out。
 */
export function createSkillsCliProbe(options: SkillsCliProbeOptions = {}) {
  const run = options.run ?? runNpxSkillsList;
  let cached: SkillsCliProbeMap | null = null;
  // 在途合并：并发 probe 共享同一次 shell out（perf-firstscreen B-5）。
  let inflight: Promise<SkillsCliProbeMap> | null = null;

  const probeOnce = async (): Promise<SkillsCliProbeMap> => {
    try {
      const { stdout } = await run();
      return parseSkillsCliList(stdout);
    } catch {
      // 无 npx / 非 0 退出 / 超时 → 空映射，不抛错（D2）。
      return new Map();
    }
  };

  return {
    /** 返回缓存的探测映射；首次调用 shell out（在途共享），后续命中缓存。 */
    async probe(): Promise<SkillsCliProbeMap> {
      if (cached) return cached;
      if (inflight) return inflight;
      inflight = probeOnce().then((result) => {
        cached = result;
        return result;
      });
      try {
        return await inflight;
      } finally {
        inflight = null;
      }
    },
    /**
     * 同步快照（perf-firstscreen B-5）：缓存命中返回映射，未就绪返回 null——
     * 调用方（skills.list）不阻塞等待 npx（冷启动 0-15s）；daemon boot 后
     * 台预热 probe，就绪后的下一次投影自然补全 provenance。
     */
    peek(): SkillsCliProbeMap | null {
      return cached;
    },
    /** 失效缓存；指定路径时仅移除对应条目，否则清空全部。 */
    invalidate(paths?: Iterable<string>): void {
      if (!cached) return;
      if (paths === undefined) {
        cached = null;
        return;
      }
      const next = new Map(cached);
      for (const path of paths) next.delete(path);
      cached = next;
    },
  };
}

/** skills-CLI 探测器实例接口。 */
export type SkillsCliProbe = ReturnType<typeof createSkillsCliProbe>;
