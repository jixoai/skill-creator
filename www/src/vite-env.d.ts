/// <reference types="@sveltejs/kit" />
/// <reference types="vite/client" />

// vite-imagetools v12 ships no client type entry — declare the
// `?…&as=picture` import contract consumed by responsive-picture.svelte
// (sources: format → srcset; img: fallback entry with intrinsic w/h).
declare module "*?as=picture" {
  const set: {
    img: { src: string; w: number; h: number };
    sources: Record<string, string>;
  };
  export default set;
}
declare module "*&as=picture" {
  const set: {
    img: { src: string; w: number; h: number };
    sources: Record<string, string>;
  };
  export default set;
}
