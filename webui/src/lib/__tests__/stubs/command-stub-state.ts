/**
 * command stub 共享契约态（skill-search-gui 走查 Case C P1 回归）：真 bits-ui
 * command 在 node_modules 含 .svelte（vitest 外置不可编译），组件测试以本地
 * stub 替换。本模块忠实建模 bits-ui 的 value 通道契约——Root(Dialog) 的 value
 * 是「选中条目的值」，输入文本只存在于 Command.Input 的 value；Item 选中经
 * 此模块写回 Root value，两条通道互不串扰。
 */
let rootValueSetter: ((value: string) => void) | null = null;

export function registerCommandRootValue(setter: ((value: string) => void) | null): void {
  rootValueSetter = setter;
}

/** Item 选中：把条目 value 写入 Root 的 value（bits-ui 契约，不触碰输入框文本）。 */
export function selectCommandItem(value: string): void {
  rootValueSetter?.(value);
}

export function resetCommandStub(): void {
  rootValueSetter = null;
}
