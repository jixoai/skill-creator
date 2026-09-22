/**
 * 用户原始需求 [2026-09-21]：「skill-wiki 我打算作为一个 monorepo 中的一个子包
 * 来维护开发，现在 skill-creator 中孵化，后续稳定了成标准了再发出来」。
 * 修订 [2026-09-22]（目录映射标准）：scopes.ts（slug 登记表）随中央根一起退役
 * ——scope 由路径客观决定，导出面只剩目录映射标准与领域契约。
 * 修订 [2026-09-22]（wiki-directory-standard 2.1）：cli-kit（createWikiCli 与
 * WikiCliHost / WikiCliCommand / CliIo 等）自根导出——skill-creator CLI 经包根
 * 组装 wiki 子命令；daemon bundle 已因 skill-search service 内联 @jixoai/search，
 * 导出 kit 不再改变 daemon 的依赖面。
 * 正交意图：
 *   [1] 孵化期公共出口：src 直出、全量再导出；稳定发版时在此收窄面。
 */
export * from "./schema.js";
export * from "./patch.js";
export * from "./workspace.js";
export * from "./sampling.js";
export * from "./gate.js";
export * from "./cli.js";
