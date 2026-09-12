/**
 * lucide 图标 mock 的共享模块（Track B2 测试）：vi.mock 工厂不能引用外层变量，
 * 经此模块间接 import svelte stub（vite 管线内编译）。
 */
export { default } from "./icon-stub.svelte";
