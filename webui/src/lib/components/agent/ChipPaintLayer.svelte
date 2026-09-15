<!--
  Composer 芯片镜像绘制层（composer-references C1）。
  官方 Lexical 芯片的 textarea 适配：本层与 textarea 同度量（.msg-body 13px/20px
  + px-3.5 py-2.5 + pre-wrap/break-words），垫在 textarea 底下渲染引用 token 的
  底色 span；文本本体仍由 textarea 绘制（色彩/光标/IME 全部不变）。芯片 span
  禁 padding/border（会移动布局破坏镜像），只有底色 + 圆角 + clone 断行。
  正交意图：[1] 镜像渲染；[2] aria-hidden（纯装饰，芯片身份由 token 文本承载）。
  妥协声明：无（span 投影的纯函数面见 composer-chips）。
-->
<script lang="ts">
  import { paintSegments, type ChipOccurrence } from "./composer-chips.js";

  let {
    text,
    occurrences,
    heightPx,
  }: {
    /** 与 textarea 完全一致的稿文（bind 同源）。 */
    text: string;
    /** 出现消费结果（composer 每次文本/registry 变化重算）。 */
    occurrences: readonly ChipOccurrence[];
    /** textarea 当前自动长高后的高度（镜像层跟随，内滚剪裁一致）。 */
    heightPx: number;
  } = $props();

  const segments = $derived(paintSegments(text, occurrences));
</script>

<div
  aria-hidden="true"
  class="msg-body pointer-events-none absolute inset-x-0 top-0 z-0 overflow-hidden whitespace-pre-wrap break-words px-3.5 py-2.5 text-transparent"
  style="height: {heightPx}px"
>
  {#each segments as segment, index (index)}
    {#if segment.kind === "chip"}
      <span
        class="rounded-[4px] bg-primary/15 [box-decoration-break:clone]"
        data-composer-chip={segment.reference.kind}
        title={segment.reference.kind === "file"
          ? segment.reference.target
          : `session: ${segment.reference.label}`}>{segment.text}</span
      >
    {:else}
      <span>{segment.text}</span>
    {/if}
  {/each}
</div>
