/**
 * dropdown-menu stub 共享开合态（Track B2 测试）：真 bits-ui 菜单在
 * node_modules 含 .svelte（vitest 外置不可编译），组件逻辑测试以同 data-slot
 * 契约的本地 stub 替换；开合态模块级共享（Root/Trigger/Content 三件套互通）。
 */
export const ddState = $state({ open: false });

export function ddReset(): void {
  ddState.open = false;
}
