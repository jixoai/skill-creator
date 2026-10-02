<!--
  用户原始需求 [2026-07-27]：「右侧『文件』子视图：SKILL.md 编辑器」（2026-09-30
  creator-editor-polish：正文升级 CodeMirror 6，懒加载 + textarea 底座）。
  修订 [2026-10-02]（design-critique R1 Gap 4/9）：dark 面色经 token 覆写统一
  （透明底 + 去 active line 全宽高亮带）；heading 去下划线（重组 default
  highlight specs——默认给 heading 的 underline 读作超链接）。
  修订 [2026-10-02]（design-critique R2）：dark 编辑面提一档亮度分层——透明底
  在 near-black 页面上无明度差（代码体与页面糊成一片、gutter 刻度难辨），
  host 落 --muted 底色（既有 token，不引入新变量）；light 走 CM 默认不动。
  正交意图：
  1. 懒加载：CodeMirror 全部经动态 import() code-split（类型导入编译期擦除）；
     模块未就绪/加载失败期间 textarea 底座保持可编辑（SSR 与弱网不阻塞）。
  2. 值同步：CM → 外部经 updateListener 回写 bind:value；外部 → CM 仅在值
     真正变化且非本次回写时 dispatch（防回环）。
  3. 面色适配：dark 由 .dark 祖先类 + 设计 token CSS 覆写（无 CM dark 主题
     注册）；light 走 CM 默认。
  妥协声明：不做 dark 主题联动（.dark 祖先覆写已覆盖编辑面；后续按需求迭代）。
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
        const [
          { basicSetup, EditorView },
          { markdown },
          { HighlightStyle, defaultHighlightStyle, syntaxHighlighting },
        ] = await Promise.all([
          loadCodemirror(),
          import("@codemirror/lang-markdown"),
          import("@codemirror/language"),
        ]);
        // R1 Gap 9：defaultHighlightStyle 给 heading 同时加了 underline + bold
        // （underline + bold 的组合在默认 specs 中唯一），underline 让标题读作
        // 超链接——重组 specs 去掉，bold 保留；link 的 underline 语义正确不动。
        // basicSetup 的 default 是 fallback:true，注册本 style 后整体接管。
        const headingStyle = HighlightStyle.define(
          defaultHighlightStyle.specs.map((spec) =>
            spec.textDecoration === "underline" && spec.fontWeight === "bold"
              ? { ...spec, textDecoration: undefined }
              : spec,
          ),
        );
        const view = new EditorView({
          doc: value,
          extensions: [
            basicSetup,
            syntaxHighlighting(headingStyle),
            markdown(),
            // WS4 走查 #11：SKILL.md 是散文型 markdown——软换行，长行不横向
            // 溢出（无横滚条裁切短行）。
            EditorView.lineWrapping,
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
  /* Dark 面色统一（R1 Gap 4，token 制、不写死色值）：CM 以 light 基线渲染
     （未注册 dark 主题），gutters #f5f5f5 底与 active line #cceeff44 全宽高亮带
     在 near-black 页面里成块——编辑区/行号槽透明融入页面，active line 高亮
     去除，光标/选区/行号色走设计 token。light 走 CM 默认，不动。 */
  /* R2 分层（Gap：透明底无明度差）：编辑面提一档既有 token（--muted），代码体
     与页面背景分层、gutter 刻度（--muted-foreground）随之可辨；host 圆角裁切。 */
  :global(.dark) .cm-host {
    background: var(--muted);
    border-radius: 0.375rem;
  }
  :global(.dark) .cm-host :global(.cm-editor) {
    background: transparent;
  }
  :global(.dark) .cm-host :global(.cm-gutters) {
    background: transparent;
    border-right: 1px solid var(--border);
    color: var(--muted-foreground);
  }
  :global(.dark) .cm-host :global(.cm-activeLine),
  :global(.dark) .cm-host :global(.cm-activeLineGutter) {
    background: transparent;
  }
  :global(.dark) .cm-host :global(.cm-cursor) {
    border-left-color: var(--foreground);
  }
  :global(.dark) .cm-host :global(.cm-selectionBackground),
  :global(.dark) .cm-host :global(.cm-focused .cm-selectionBackground) {
    background: color-mix(in oklab, var(--primary) 30%, transparent);
  }
  .cm-hidden {
    display: none;
  }
</style>
