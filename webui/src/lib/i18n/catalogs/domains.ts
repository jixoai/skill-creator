/**
 * 用户原始需求 [2026-10-04]（B 线收尾编排裁决）：「继续打磨完善」——多子代理
 * 并行适配期，新域各自建文件、本聚合点预声明，消除词典单文件的批间写冲突。
 * 正交意图：
 *   [1] 增量域登记处：en/zh 成对导出（域内 keyof 校验 zh 键齐全）。
 *   [2] 域文件规约：export const <domain>En = {...} as const; +
 *       export const <domain>Zh: Record<keyof typeof <domain>En, string> = {...};
 *       ——新域在 catalogs/domains/ 建独立文件并 import 进本文件，勿改 base。
 */
import { agentExtensionEn, agentExtensionZh } from "./domains/agent-extension.js";
import { creatorExtraEn, creatorExtraZh } from "./domains/creator-extra.js";
import { dashCountsEn, dashCountsZh } from "./domains/dash-counts.js";
import { errorHintsEn, errorHintsZh } from "./domains/error-hints.js";
import { settingsEn, settingsZh } from "./domains/settings.js";
import { shellExtraEn, shellExtraZh } from "./domains/shell-extra.js";
import { slashModesEn, slashModesZh } from "./domains/slash-modes.js";

export {
  agentExtensionEn,
  agentExtensionZh,
  creatorExtraEn,
  creatorExtraZh,
  dashCountsEn,
  dashCountsZh,
  errorHintsEn,
  errorHintsZh,
  settingsEn,
  settingsZh,
  shellExtraEn,
  shellExtraZh,
  slashModesEn,
  slashModesZh,
};
