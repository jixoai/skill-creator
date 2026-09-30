<!--
  用户原始需求 [2026-07-27]：「右侧『文件』子视图：SKILL.md 编辑器」（2026-09-30
  creator-editor-polish：正文升级 CodeMirror 6，懒加载 + textarea 底座）。
  正交意图：
  1. 懒加载：CodeMirror 全部经动态 import() code-split（类型导入编译期擦除）；
     模块未就绪/加载失败期间 textarea 底座保持可编辑（SSR 与弱网不阻塞）。
  2. 值同步：CM → 外部经 updateListener 回写 bind:value；外部 → CM 仅在值
     真正变化且非本次回写时 dispatch（防回环）。
  妥协声明：主题用 CM 默认 + 最小 CSS 变量适配；不做 dark 主题联动（后续按
  需求迭代）。
-->
<script lang="ts" module>
  import type { EditorView } from "@codemirror/view";

  /** 懒加载结果（codemirror 元包 re-export 全部所需 API）；失败不缓存。 */
  let cmModule: Promise<typeof import("codemirror")> | null = null;
  function loadCodemirror() {
    cmModule ??= import("codemirror");
    return cmModule;
  }

  /** 当前挂载的视图句柄（同刻至多一个实例）。 */
  let activeView: EditorView | null = null;
</script>

<script lang="ts">
  import { onMount } from "svelte";

  let {
    value = $bindable(""),
    placeholder = "",
  }: {
    value?: string;
    placeholder?: string;
  } = $props();

  let host = $state<HTMLElement | null>(null);
  let ready = $state(false);
  let failed = $state(false);
  // 本组件回写引发的外部值变化标记（回环防线）。
  let selfUpdate = false;

  onMount(() => {
    const el = host;
    if (!el) return;
    void (async () => {
      try {
        const [{ basicSetup, EditorView }, { markdown }] = await Promise.all([
          loadCodemirror(),
          import("@codemirror/lang-markdown"),
        ]);
        const view = new EditorView({
          doc: value,
          extensions: [
            basicSetup,
            markdown(),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              selfUpdate = true;
              value = update.state.doc.toString();
            }),
          ],
          parent: el,
        });
        activeView = view;
        ready = true;
      } catch {
        // 加载失败：textarea 底座继续承担编辑（host 不再渲染）。
        failed = true;
      }
    })();

    return () => {
      activeView?.destroy();
      activeView = null;
    };
  });

  // 外部值 → CM：仅当 CM 未在本次用户编辑中产生该值时同步。
  $effect(() => {
    if (activeView === null) return;
    const incoming = value;
    const current = activeView.state.doc.toString();
    if (selfUpdate) {
      selfUpdate = false;
      return;
    }
    if (incoming !== current) {
      activeView.dispatch({
        changes: { from: 0, to: current.length, insert: incoming },
      });
    }
  });
</script>

<!-- host 常驻挂载（ready 前隐藏）：onMount 时绑定已就位，CM 挂入后切换可见。 -->
<div bind:this={host} class="cm-host min-h-0 flex-1 overflow-hidden" class:cm-hidden={!ready}></div>
{#if !ready}
  <textarea
    bind:value
    {placeholder}
    spellcheck="false"
    class="w-full min-h-0 flex-1 resize-y rounded-md border border-input bg-input/20 px-2 py-1.5 font-mono text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
  ></textarea>
  {#if !failed}
    <span class="sr-only">Loading editor…</span>
  {/if}
{/if}

<style>
  .cm-host {
    :global(.cm-editor) {
      height: 100%;
      font-size: 12px;
    }
    :global(.cm-scroller) {
      font-family: var(--font-mono, ui-monospace, monospace);
      line-height: 1.4;
    }
  }
  .cm-hidden {
    display: none;
  }
</style>
