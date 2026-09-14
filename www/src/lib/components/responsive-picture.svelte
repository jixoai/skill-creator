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
  教训（2026-09-15 CI 实证）：绝不在渲染层重写资产 URL——vite 在 subpath
  构建（SITE_BASE）下已为 srcset 打上 base 前缀，root 构建产相对形态，
  两者皆正确；本地 preview 会对 /_app 做根路径别名，只有带 SITE_BASE 的
  真实构建产物才是判据（曾据 preview 误判并引入双前缀 404，已回退）。
-->
<script lang="ts">
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
</script>

<picture>
  {#each Object.entries(set.sources) as [format, srcset] (format)}
    {#if format !== fallbackFormat}
      <source type={`image/${format}`} {srcset} />
    {/if}
  {/each}
  <img
    src={set.img.src}
    srcset={set.sources[fallbackFormat]}
    width={set.img.w}
    height={set.img.h}
    {alt}
    class={klass}
    loading={eager ? "eager" : "lazy"}
    decoding="async"
  />
</picture>
