/**
 * $app/navigation 测试 stub（SvelteKit 虚拟模块，root vitest 管线无法解析）：
 * webui 测试项目把它 alias 到本文件使模块解析成立；具体断言由各测试经
 * vi.mock("$app/navigation") 提供自己的 spy，本文件的 no-op 只作解析兜底。
 */
export function goto(_url: string): void {
  // no-op — 由测试的 vi.mock 工厂接管。
}
