/**
 * 响应式 shell 路由 stub（WS5 走查 B 回归测试）：portal-context 的
 * useParams/useSearch mock 需要可变且响应式的 params/search——裸对象翻转不会
 * 让组件的 $derived(search) 重跑，子视图切换断言无从生效。
 */
export const shellRouteState = $state<{
  params: Record<string, string>;
  search: Record<string, string | undefined>;
}>({
  params: {},
  search: {},
});
