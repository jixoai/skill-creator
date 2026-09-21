/**
 * `$app/state` 的 root vitest 管线物理替身（与 app-navigation-stub 同角色）：
 * SvelteKit 虚拟模块在此管线解析不了；resolve 必须成立，具体行为（params/url
 * 按测试定制）由测试内 vi.mock 覆盖。
 */
export const page = {
  url: {
    pathname: "/",
    searchParams: new URLSearchParams(),
  },
  params: {} as Record<string, string | undefined>,
};
