/**
 * 用户原始需求 [2026-09-30]：「setup 还需要支持更加复杂的参数，来支持 model 的
 * 配置，就是 webui 中配置 provider，这些都需要通过 cli 提供同源的支持」
 * （cli-surface-parity D4/D5）。
 *
 * 正交意图：
 *   [1] `skill-creator model` 子命令族的 argv 解析与终端投影（list/routes/use/
 *       route add|remove/key set|clear/test）；key 明文永不回显。
 *   [2] setup `--model` 参数段的装配逻辑（key → route → use 顺序；供 cli.ts 复用，
 *       与 model 子命令同一实现源）。
 *   [3] 同源边界：只消费 dshSettings/modelCatalog（与 WebUI 同一份持久化真相）。
 */
import type { DaemonDomain } from "../daemon/domain.js";
import type {
  DshModelRoute,
  DshRouteConnectionTestInput,
  DshSettingsUpdate,
  ModelProviderCatalogEntry,
} from "../shared/contracts/dsh-runtime.js";

const USAGE = `Usage:
  skill-creator model list [--json]
  skill-creator model routes [--json]
  skill-creator model use <provider> <model> [--effort <tier>]
  skill-creator model route add <provider> --base-url <url> [--api <protocol>] --model <id> [--model <id>]...
  skill-creator model route remove <provider>
  skill-creator model key set <provider> <apiKey|->
  skill-creator model key clear <provider>
  skill-creator model test [<provider> [<model>]]`;

/** 用法错误（exit 2）。 */
export class ModelCliUsageError extends Error {}

function parseArgs(
  argv: string[],
  valueFlags: readonly string[],
  repeatFlags: readonly string[] = [],
): { positionals: string[]; values: Map<string, string>; repeats: Map<string, string[]> } {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const repeats = new Map<string, string[]>();
  const known = new Set([...valueFlags, ...repeatFlags]);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      let key: string;
      let inlineValue: string | undefined;
      if (eq > 2) {
        key = token.slice(2, eq);
        inlineValue = token.slice(eq + 1);
      } else {
        key = token.slice(2);
      }
      if (!known.has(key)) throw new ModelCliUsageError(`unknown flag --${key}\n${USAGE}`);
      const value = inlineValue ?? argv[++i];
      if (value === undefined) throw new ModelCliUsageError(`missing value for --${key}\n${USAGE}`);
      if (repeatFlags.includes(key)) {
        repeats.set(key, [...(repeats.get(key) ?? []), value]);
      } else {
        values.set(key, value);
      }
      continue;
    }
    positionals.push(token);
  }
  return { positionals, values, repeats };
}

function catalogEntry(
  catalog: ModelProviderCatalogEntry[],
  provider: string,
): ModelProviderCatalogEntry | undefined {
  return catalog.find((entry) => entry.provider === provider);
}

/** 目录条目 → 完整路由（api/baseURL/models 全推导；供 use 自动补路由）。 */
function routeFromCatalog(entry: ModelProviderCatalogEntry): DshModelRoute {
  return {
    provider: entry.provider,
    api: entry.api,
    baseURL: entry.baseURL,
    models: entry.models.map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
    })),
  };
}

async function listCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  const { positionals } = parseArgs(
    argv.filter((a) => a !== "--json"),
    [],
    [],
  );
  if (positionals.length > 0) throw new ModelCliUsageError(USAGE);
  const catalog = domain.modelCatalog.list();
  const view = await domain.dshSettings.getView();
  const routed = new Set(view.settings.modelRoutes.map((route) => route.provider));
  if (json) {
    console.log(
      JSON.stringify(
        { catalog, routes: view.settings.modelRoutes, model: view.settings.model },
        null,
        2,
      ),
    );
    return 0;
  }
  for (const entry of catalog) {
    const marks = [
      routed.has(entry.provider) ? "routed" : null,
      view.settings.model.provider === entry.provider ? "active" : null,
    ].filter(Boolean);
    console.log(`${entry.provider}${marks.length > 0 ? `  [${marks.join(", ")}]` : ""}`);
    console.log(`  ${entry.api}  ${entry.baseURL}`);
    console.log(`  models: ${entry.models.map((m) => m.id).join(", ")}`);
  }
  const customOnly = view.settings.modelRoutes.filter(
    (route) => !catalogEntry(catalog, route.provider),
  );
  for (const route of customOnly) {
    console.log(
      `${route.provider}  [routed${view.settings.model.provider === route.provider ? ", active" : ""}]`,
    );
    console.log(`  ${route.api ?? "(catalog api)"}  ${route.baseURL}`);
    console.log(`  models: ${route.models.map((m) => m.id).join(", ")}`);
  }
  return 0;
}

async function routesCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  const { positionals } = parseArgs(
    argv.filter((a) => a !== "--json"),
    [],
    [],
  );
  if (positionals.length > 0) throw new ModelCliUsageError(USAGE);
  const view = await domain.dshSettings.getView();
  const configured = new Set(view.providers.filter((p) => p.configured).map((p) => p.provider));
  if (json) {
    // key 明文不回显（design D4）：只投影 configured 状态。
    console.log(
      JSON.stringify(
        {
          model: view.settings.model,
          modelRoutes: view.settings.modelRoutes,
          credentials: view.settings.modelRoutes
            .map((route) => route.provider)
            .concat([...configured])
            .filter((p, i, list) => list.indexOf(p) === i)
            .map((provider) => ({ provider, configured: configured.has(provider) })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  console.log(
    `active: ${view.settings.model.provider}/${view.settings.model.model}` +
      `${view.settings.model.reasoningEffort ? ` (effort ${view.settings.model.reasoningEffort})` : ""}`,
  );
  if (view.settings.modelRoutes.length === 0) {
    console.log("no custom routes.");
    return 0;
  }
  for (const route of view.settings.modelRoutes) {
    console.log(
      `${route.provider}  ${route.api ?? "(catalog api)"}  ${route.baseURL}  key: ${
        configured.has(route.provider) ? "configured" : "not set"
      }`,
    );
    console.log(`  models: ${route.models.map((m) => m.id).join(", ")}`);
  }
  return 0;
}

async function useCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs(argv, ["effort"]);
  if (positionals.length !== 2) throw new ModelCliUsageError(USAGE);
  const [provider, model] = positionals;
  const view = await domain.dshSettings.getView();
  const existing = view.settings.modelRoutes.find((route) => route.provider === provider);
  const catalog = domain.modelCatalog.list();
  const entry = catalogEntry(catalog, provider);
  let routes = view.settings.modelRoutes;
  if (!existing && entry) {
    routes = [...routes, routeFromCatalog(entry)];
    console.log(`route added for ${provider} from catalog (${entry.baseURL}).`);
  }
  if (!existing && !entry) {
    throw new ModelCliUsageError(
      `provider "${provider}" has no route and is not in the catalog; run ` +
        `"skill-creator model route add ${provider} --base-url <url> --api <protocol> --model <id>" first`,
    );
  }
  const effort = values.get("effort");
  if (effort !== undefined) {
    const route = routes.find((r) => r.provider === provider);
    const modelEntry = route?.models.find((m) => m.id === model);
    const tiers = modelEntry?.efforts ?? entry?.models.find((m) => m.id === model)?.effortTiers;
    if (tiers !== undefined && !tiers.includes(effort)) {
      throw new ModelCliUsageError(
        `effort "${effort}" not available for ${provider}/${model}; tiers: ${tiers.join(", ")}`,
      );
    }
  }
  const patch: DshSettingsUpdate = {
    ...(routes !== view.settings.modelRoutes ? { modelRoutes: routes } : {}),
    model: {
      provider,
      model,
      ...(effort !== undefined ? { reasoningEffort: effort } : {}),
    },
  };
  const result = await domain.dshSettings.update(patch);
  if (result.outcome !== "updated") {
    console.error(`model use rejected (${result.code}): ${result.detail}`);
    return 1;
  }
  console.log(
    `active model: ${provider}/${model}${effort !== undefined ? ` (effort ${effort})` : ""}` +
      `${result.changed ? "" : "  (unchanged)"}`,
  );
  return 0;
}

async function routeAddCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const { positionals, values, repeats } = parseArgs(argv, ["base-url", "api"], ["model"]);
  if (positionals.length !== 1 || values.get("base-url") === undefined) {
    throw new ModelCliUsageError(USAGE);
  }
  const provider = positionals[0];
  const modelIds = repeats.get("model") ?? [];
  if (modelIds.length === 0)
    throw new ModelCliUsageError("route add requires at least one --model <id>");
  const view = await domain.dshSettings.getView();
  if (view.settings.modelRoutes.some((route) => route.provider === provider)) {
    throw new ModelCliUsageError(
      `route for "${provider}" already exists; remove it first (model route remove ${provider})`,
    );
  }
  let api = values.get("api");
  if (api === undefined) {
    const entry = catalogEntry(domain.modelCatalog.list(), provider);
    if (!entry) {
      throw new ModelCliUsageError(
        `--api is required for custom providers (provider "${provider}" is not in the catalog)`,
      );
    }
    api = entry.api;
  }
  const route: DshModelRoute = {
    provider,
    api,
    baseURL: values.get("base-url")!,
    models: modelIds.map((id) => ({ id })),
  };
  const result = await domain.dshSettings.update({
    modelRoutes: [...view.settings.modelRoutes, route],
  });
  if (result.outcome !== "updated") {
    console.error(`route add rejected (${result.code}): ${result.detail}`);
    return 1;
  }
  console.log(`route added: ${provider} -> ${route.baseURL} (${api})`);
  return 0;
}

async function routeRemoveCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const { positionals } = parseArgs(argv, [], []);
  if (positionals.length !== 1) throw new ModelCliUsageError(USAGE);
  const provider = positionals[0];
  const view = await domain.dshSettings.getView();
  if (view.settings.model.provider === provider) {
    throw new ModelCliUsageError(
      `route "${provider}" hosts the active model; switch first (skill-creator model use <other> <model>)`,
    );
  }
  if (!view.settings.modelRoutes.some((route) => route.provider === provider)) {
    throw new ModelCliUsageError(`no route for "${provider}"`);
  }
  const result = await domain.dshSettings.update({
    modelRoutes: view.settings.modelRoutes.filter((route) => route.provider !== provider),
  });
  if (result.outcome !== "updated") {
    console.error(`route remove rejected (${result.code}): ${result.detail}`);
    return 1;
  }
  console.log(`route removed: ${provider}`);
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function keyCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const action = argv[0];
  if (action === "set") {
    const { positionals } = parseArgs(argv.slice(1), [], []);
    if (positionals.length !== 2) throw new ModelCliUsageError(USAGE);
    const [provider, keyRef] = positionals;
    const apiKey = keyRef === "-" ? await readStdin() : keyRef;
    if (apiKey.length === 0) throw new ModelCliUsageError("api key is empty");
    const result = await domain.dshSettings.setCredential({ provider, apiKey });
    if (result.outcome !== "stored") {
      console.error(`key set rejected (${result.code}): ${result.detail}`);
      return 1;
    }
    console.log(`key stored for ${provider}.`);
    return 0;
  }
  if (action === "clear") {
    const { positionals } = parseArgs(argv.slice(1), [], []);
    if (positionals.length !== 1) throw new ModelCliUsageError(USAGE);
    await domain.dshSettings.clearCredential({ provider: positionals[0] });
    console.log(`key cleared for ${positionals[0]}.`);
    return 0;
  }
  throw new ModelCliUsageError(USAGE);
}

async function testCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const { positionals } = parseArgs(argv, [], []);
  if (positionals.length > 2) throw new ModelCliUsageError(USAGE);
  const view = await domain.dshSettings.getView();
  const provider = positionals[0] ?? view.settings.model.provider;
  const route =
    view.settings.modelRoutes.find((r) => r.provider === provider) ??
    (() => {
      const entry = catalogEntry(domain.modelCatalog.list(), provider);
      return entry ? routeFromCatalog(entry) : null;
    })();
  if (!route) {
    throw new ModelCliUsageError(
      `no route for "${provider}"; add one first or pick a catalog provider`,
    );
  }
  const modelId =
    positionals[1] ??
    (view.settings.model.provider === provider ? view.settings.model.model : route.models[0]?.id);
  if (modelId === undefined) throw new ModelCliUsageError(`route "${provider}" has no models`);
  const input: DshRouteConnectionTestInput = {
    api: route.api ?? catalogEntry(domain.modelCatalog.list(), provider)?.api ?? "",
    baseURL: route.baseURL,
    provider,
    modelId,
  };
  const result = await domain.dshSettings.testConnection(input);
  if (result.outcome === "ok") {
    console.log(`ok — ${provider}/${modelId} responded in ${result.latencyMs}ms`);
    return 0;
  }
  console.error(`failed — ${result.detail}`);
  return 1;
}

/** `skill-creator model <子命令>` 入口：进程内组装 domain（与 mcp stdio 同一先例）。 */
export async function runModelCli(): Promise<number> {
  const argv = process.argv.slice(process.argv.indexOf("model") + 1);
  const sub = argv[0];
  const { createDaemonDomain } = await import("../daemon/domain.js");
  const domain = createDaemonDomain(undefined, { probeWarmup: false });
  try {
    if (sub === "list") return await listCommand(domain, argv.slice(1));
    if (sub === "routes") return await routesCommand(domain, argv.slice(1));
    if (sub === "use") return await useCommand(domain, argv.slice(1));
    if (sub === "route") {
      const action = argv[1];
      if (action === "add") return await routeAddCommand(domain, argv.slice(2));
      if (action === "remove") return await routeRemoveCommand(domain, argv.slice(2));
      throw new ModelCliUsageError(USAGE);
    }
    if (sub === "key") return await keyCommand(domain, argv.slice(1));
    if (sub === "test") return await testCommand(domain, argv.slice(1));
  } catch (error) {
    if (error instanceof ModelCliUsageError) {
      console.error(error.message);
      return 2;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  console.error(USAGE);
  return 2;
}

/** setup `--model` 参数段（design D5）：key → route → use 顺序；失败抛 typed 错误。 */
export async function applyModelSetupSection(
  domain: DaemonDomain,
  flags: {
    provider: string;
    model: string;
    effort?: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
  },
): Promise<void> {
  const lowerKey = flags.apiKey?.toLowerCase();
  if (lowerKey !== undefined && lowerKey !== "none") {
    const result = await domain.dshSettings.setCredential({
      provider: flags.provider,
      apiKey: flags.apiKey!,
    });
    if (result.outcome !== "stored") {
      throw new Error(`key set rejected (${result.code}): ${result.detail}`);
    }
    console.log(`key stored for ${flags.provider}.`);
  }
  const view = await domain.dshSettings.getView();
  if (!view.settings.modelRoutes.some((route) => route.provider === flags.provider)) {
    const entry = catalogEntry(domain.modelCatalog.list(), flags.provider);
    if (!entry && flags.baseUrl === undefined) {
      throw new Error(
        `provider "${flags.provider}" is not routed and not in the catalog; ` +
          "pass --base-url (and --api for non-catalog providers)",
      );
    }
    const route: DshModelRoute = entry
      ? routeFromCatalog(entry)
      : {
          provider: flags.provider,
          api: flags.api,
          baseURL: flags.baseUrl!,
          models: [{ id: flags.model }],
        };
    const result = await domain.dshSettings.update({
      modelRoutes: [...view.settings.modelRoutes, route],
    });
    if (result.outcome !== "updated") {
      throw new Error(`route add rejected (${result.code}): ${result.detail}`);
    }
    console.log(`route added: ${flags.provider} -> ${route.baseURL}`);
  }
  const useArgv = [
    flags.provider,
    flags.model,
    ...(flags.effort !== undefined ? ["--effort", flags.effort] : []),
  ];
  const code = await useCommand(domain, useArgv);
  if (code !== 0) throw new Error(`model use failed for ${flags.provider}/${flags.model}`);
}
