/** workspaces store 测试替身（PageOutlet DOM 测试用：tab-session 依赖面）。 */
export const workspaceState = $state({
  workspaces: [] as Array<{ id: string; kind: string; label: string }>,
  loading: false,
  error: null as string | null,
});
