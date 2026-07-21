/**
 * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)」。
 * 正交意图：在页面组件创建前验证 Workspace 与可选 Provider ID，并将非法地址规范化到 Global Workspace。
 */
import { redirect } from "@sveltejs/kit";
import {
  GLOBAL_WORKSPACE_ID,
  ProviderIdSchema,
  WorkspaceIdSchema,
} from "$shared/contracts/workspaces.js";
import { providerCatalogEntry } from "$shared/provider-catalog.js";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params, url }) => {
  const parsed = WorkspaceIdSchema.safeParse(params.id);
  const providerValue = url.searchParams.get("provider");
  const provider = providerValue === null ? null : ProviderIdSchema.safeParse(providerValue);
  if (
    !parsed.success ||
    (provider !== null && (!provider.success || !providerCatalogEntry(provider.data)))
  ) {
    throw redirect(307, `/workspace/${GLOBAL_WORKSPACE_ID}`);
  }
  return { workspaceId: parsed.data, providerId: provider?.data ?? null };
};
