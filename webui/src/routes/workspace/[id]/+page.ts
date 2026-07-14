/**
 * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)」。
 * 正交意图：在页面组件创建前验证 Workspace ID，并将非法地址规范化到 Home Workspace。
 */
import { redirect } from "@sveltejs/kit";
import { HOME_WORKSPACE_ID, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  const parsed = WorkspaceIdSchema.safeParse(params.id);
  if (!parsed.success) throw redirect(307, `/workspace/${HOME_WORKSPACE_ID}`);
  return { workspaceId: parsed.data };
};
