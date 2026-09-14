<!--
  ResponsivePicture (src/lib/components/responsive-picture.svelte)

  用户原始需求 [2026-09-15]：「截图素材放进 www/static/ 下合适路径」+
  jixoai 图像管线法则（栅格资产走 vite-imagetools，多宽度 webp+png）。
  正交意图：
    [1] vite-imagetools `?…&as=picture` 导入契约的唯一渲染器：
        sources 映射 format → srcset（宽度描述符），img 携带 fallback
        （最后请求格式的最大尺寸）与 src/w/h（无布局偏移）。
    [2] 每个 fallback 之外的格式产出一个 <source> 候选；img 保留自身
        格式的 srcset 与内在宽高。
  妥协声明：与 opentray/unipty 站点同构的站点自有组件（registry 不提供
  图像渲染面）；为保持家族一致性按同契约实现。
-->
<script lang="ts">
  import { base } from "$app/paths";

  export interface PictureSet {
    img: { src: string; w: number; h: number };
    sources: Record<string, string>;
  }

  let {
    set,
    alt = "",
    class: klass = "",
    eager = false,
  }: { set: PictureSet; alt?: string; class?: string; eager?: boolean } = $props();

  /** format of the fallback entry (extension of img.src, e.g. "png") */
  const fallbackFormat = $derived(set.img.src.match(/\.([a-z]+)$/)?.[1] ?? "");

  // vite-imagetools emits root-absolute /_app/... URLs that ignore kit's
  // paths.base — on a subpath deploy (GitHub Pages /skill-creator/) the
  // browser would request them outside the site scope and 404. dev/preview
  // servers alias /_app at the origin root, which hides the bug; only the
  // rendered URL shape matters in production. Prefix every URL with base
  // ('' in root builds — URLs pass through unchanged).
  function withBase(url: string): string {
    return url.startsWith("/") ? `${base}${url}` : url;
  }

  function withBaseSrcset(srcset: string): string {
    return srcset
      .split(",")
      .map((part) => {
        const token = part.trim().match(/^(\S+)(.*)$/);
        return token ? `${withBase(token[1])}${token[2]}` : part.trim();
      })
      .join(", ");
  }

  const sources = $derived(
    Object.fromEntries(
      Object.entries(set.sources).map(([format, srcset]) => [format, withBaseSrcset(srcset)]),
    ),
  );
  const imgSrc = $derived(withBase(set.img.src));
</script>

<picture>
  {#each Object.entries(sources) as [format, srcset] (format)}
    {#if format !== fallbackFormat}
      <source type={`image/${format}`} {srcset} />
    {/if}
  {/each}
  <img
    src={imgSrc}
    srcset={sources[fallbackFormat]}
    width={set.img.w}
    height={set.img.h}
    {alt}
    class={klass}
    loading={eager ? "eager" : "lazy"}
    decoding="async"
  />
</picture>
