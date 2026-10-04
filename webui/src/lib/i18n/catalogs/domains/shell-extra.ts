/**
 * 用户原始需求 [2026-10-04]：「继续打磨完善」——shell-extra 域 i18n 化
 * （webui-i18n-bilingual B 线收尾批；域文件规约见 catalogs/domains.ts）。
 * 正交意图：
 *   [1] shell-extra 域词典（en/zh 键成对，keyof 校验齐全）。
 */
export const shellExtraEn = {} as const;
export const shellExtraZh: Record<keyof typeof shellExtraEn, string> = {};
