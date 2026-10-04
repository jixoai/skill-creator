/**
 * 用户原始需求 [2026-10-03]（Owner 裁决）：「WebUI 做中英双语（i18n）」。
 * 正交意图：
 *   [1] 英文词典聚合层 = base（存量 A/C 类域）+ domains（后续批增量域文件）；
 *       公共类型（EnCatalog/MessageKey）在此拥有——消费面零改动。
 */
import { enBase } from "./base/en.js";
import {
  agentExtensionEn,
  settingsEn,
  shellExtraEn,
  creatorExtraEn,
  dashCountsEn,
  errorHintsEn,
  slashModesEn,
} from "./domains.js";

export const en = {
  ...enBase,
  ...agentExtensionEn,
  ...settingsEn,
  ...shellExtraEn,
  ...creatorExtraEn,
  ...dashCountsEn,
  ...errorHintsEn,
  ...slashModesEn,
} as const;
export type EnCatalog = typeof en;
export type MessageKey = keyof EnCatalog;
