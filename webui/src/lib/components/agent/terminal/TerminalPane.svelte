<!--
  终端 pane（skills-agent-page 1.6 → skills-agent-page-zcode-parity 2.3）：
  每 tab 一个常驻 xterm 实例（ZCode Terminal.tsx:358-382 forceMount +
  data-[state=inactive]:hidden 的 Svelte 等价物——dock 全量挂载 pane，非活动
  display:none，切换 tab 只翻可见性，绝不重造实例）。
  用户原始需求 [2026-10-04]（design §2）：「每个 session 独立保活 xterm/pane；
  激活时执行 fit→focus；切换只隐藏 inactive pane，不重新构造。」
  ZCode 逐条对照（TerminalSession.tsx）：
    - 784-796 initial fit before create → 两段式 attachTerminalPane（带真实尺寸建会话）
    - 225-289 scheduleFitAndResize：拖拽期 300ms 低频预览，松手 final flush
    - 291-311 requestFocus：激活下一帧确认可见再 focus
    - 810-845 attachCustomKeyEventHandler：Ctrl/Cmd+C 有选区改复制、Ctrl/Cmd+V 粘贴
    - 38-39 字体：fontSize 13 + ZCode 字体栈
    - 1051-1073 卸载 dispose：observer/订阅/term.dispose 全量回收
  正交意图：
    [1] xterm 生命周期：动态 import（Terminal + FitAddon + css 懒 chunk），
        ResizeObserver → fit → resize 协议帧（client 同值去重 + creating 暂存），
        卸载 dispose。
    [2] 协议接线：订阅/写入/清屏；creating 态占位（create ack 未达时 client 丢弃输入）。
    [3] 可见性调度：激活 = fit + resize + focus（rAF）；隐藏 pane 不参与 fit/resize。
  妥协声明：（a）主题跟随 shadcn token（ZCode mergeTerminalTheme 的 profile
    theme 无本仓事实源）；（b）Windows IME textarea 兜底（isWindowsDesktop 专属）
    不移植——本产品 webview 无 Windows 桌面判定事实源。
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import {
    attachTerminalPane,
    resizeTerminal,
    subscribeTerminal,
    writeTerminal,
  } from "./terminal-client.svelte";

  let {
    sessionId,
    active = false,
    resizing = false,
  }: {
    sessionId: string;
    /** 本 pane 是否为当前 workspace 的活动 tab（fit/focus 的唯一准入）。 */
    active: boolean;
    /** 面板分隔条拖拽中（ZCode isPanelResizing：拖拽期低频 resize，松手 final）。 */
    resizing?: boolean;
  } = $props();

  /** ZCode TerminalSession.tsx:38-39 DEFAULT_TERMINAL_FONT_FAMILY + fontSize 13。 */
  const TERMINAL_FONT_FAMILY =
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, 'Cascadia Mono', 'JetBrains Mono', 'MesloLGS NF', 'Hack Nerd Font', monospace";
  const TERMINAL_FONT_SIZE = 13;
  /** ZCode TerminalSession.tsx:40 TERMINAL_RESIZE_DRAG_THROTTLE_MS。 */
  const RESIZE_DRAG_THROTTLE_MS = 300;

  let host = $state<HTMLElement | null>(null);
  let ready = $state(false);

  // xterm 句柄与调度状态（组件生命周期私有；ZCode 同构 ref 族）。
  let terminal: import("@xterm/xterm").Terminal | null = null;
  let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;
  let observer: ResizeObserver | null = null;
  let unsubscribe: (() => void) | null = null;
  let disposed = false;
  // svelte-ignore state_referenced_locally —— 初始值快照 + $effect 镜像（见下）
  let activeRef = active;
  // svelte-ignore state_referenced_locally
  let resizingRef = resizing;
  let wasResizing = false;
  let resizeRAF = 0;
  let focusRAF = 0;
  let dragThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 当前协议 sessionId（draft 换轨后随 prop 前移）：write/resize 必须用新 id；
   * 输出订阅例外——订阅闭包绑定的 ledger 对象在换轨时整体迁移（listeners 原样
   * 保留），保持挂载期订阅不动即持续收流，重订反而会镜像双放。
   */
  // svelte-ignore state_referenced_locally
  let sessionIdRef = sessionId;

  $effect(() => {
    sessionIdRef = sessionId;
  });

  function clearDragThrottle(): void {
    if (dragThrottleTimer !== null) {
      clearTimeout(dragThrottleTimer);
      dragThrottleTimer = null;
    }
  }

  /** fit + resize 协议帧（rAF 合帧；隐藏/零尺寸布局跳过——ZCode requestFitAndResize 守卫）。 */
  function requestFit(): void {
    if (resizeRAF !== 0) cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => {
      resizeRAF = 0;
      if (disposed || !activeRef) return;
      if (terminal === null || fitAddon === null || host === null) return;
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return;
      try {
        fitAddon.fit();
      } catch {
        return; // 未布局态忽略
      }
      const dimensions = fitAddon.proposeDimensions();
      if (dimensions && dimensions.cols > 1 && dimensions.rows > 1) {
        resizeTerminal(sessionIdRef, dimensions.cols, dimensions.rows);
      }
    });
  }

  /** ZCode scheduleFitAndResize：拖拽期仅 300ms 低频预览；final/非拖拽立即执行。 */
  function scheduleFit(reason: "observer" | "visible" | "drag" | "final"): void {
    if (!resizingRef || reason === "final") {
      clearDragThrottle();
      requestFit();
      return;
    }
    if (dragThrottleTimer !== null) return;
    dragThrottleTimer = setTimeout(() => {
      dragThrottleTimer = null;
      requestFit();
    }, RESIZE_DRAG_THROTTLE_MS);
  }

  /** ZCode requestFocus：下一帧确认仍可见再聚焦（xterm textarea open 后才存在）。 */
  function requestFocus(): void {
    if (focusRAF !== 0) cancelAnimationFrame(focusRAF);
    focusRAF = requestAnimationFrame(() => {
      focusRAF = 0;
      if (disposed || !activeRef || terminal === null) return;
      terminal.focus();
    });
  }

  // 可见性调度（ZCode TerminalSession.tsx:313-319 isVisible effect）。
  $effect(() => {
    activeRef = active;
    if (active) {
      scheduleFit("visible");
      requestFocus();
    }
  });

  // 拖拽结束 flush（ZCode TerminalSession.tsx:321-327 isPanelResizing effect）。
  $effect(() => {
    resizingRef = resizing;
    if (wasResizing && !resizing && activeRef) {
      scheduleFit("final");
    }
    wasResizing = resizing;
  });

  onMount(() => {
    void (async () => {
      // 懒加载 chunk：xterm 家族只在首个 pane 挂载时进入 bundle。
      const [{ Terminal }, { FitAddon }, css] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/xterm/css/xterm.css"),
      ]);
      void css;
      if (disposed || host === null) return;
      const styles = globalThis.getComputedStyle(document.documentElement);
      const token = (name: string, fallback: string): string =>
        styles.getPropertyValue(name).trim() || fallback;
      const term = new Terminal({
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: TERMINAL_FONT_SIZE,
        cursorBlink: true,
        theme: {
          foreground: token("--foreground", "#e4e4e7"),
          background: token("--background", "#09090b"),
          cursor: token("--primary", "#10b981"),
          selectionBackground: "#3f3f46aa",
        },
      });
      terminal = term;
      const fit = new FitAddon();
      fitAddon = fit;
      term.loadAddon(fit);
      term.open(host);
      // 剪贴板快捷键（ZCode TerminalSession.tsx:810-845）：Ctrl/Cmd+C 有选区改复制；
      // Ctrl/Cmd+V 手动读剪贴板单次 paste（preventDefault 防与原生 paste 双写）。
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        if (!(event.metaKey || event.ctrlKey)) return true;
        const key = event.key.toLowerCase();
        if (key === "c" && term.hasSelection()) {
          void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
          return false;
        }
        if (key === "v") {
          event.preventDefault();
          event.stopPropagation();
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text) term.paste(text);
            })
            .catch(() => {});
          return false;
        }
        return true;
      });
      term.onData((data) => {
        writeTerminal(sessionIdRef, data);
      });
      unsubscribe = subscribeTerminal(sessionId, (event) => {
        if (event.kind === "data") term.write(event.data);
        else if (event.kind === "reset") term.reset();
        // exit：client 同步删除 tab → 本 pane 卸载（ZCode exitTerminalSession）。
      });
      // 两段式 create：可见且有布局时先 fit 出真实尺寸再建会话（ZCode 784-796）。
      let initialSize: { cols: number; rows: number } | undefined;
      if (activeRef && host.clientWidth > 0 && host.clientHeight > 0) {
        try {
          fit.fit();
          const dimensions = fit.proposeDimensions();
          if (dimensions && dimensions.cols > 1 && dimensions.rows > 1) {
            initialSize = { cols: dimensions.cols, rows: dimensions.rows };
          }
        } catch {
          /* 首个 ResizeObserver 回调补 fit */
        }
      }
      ready = true;
      attachTerminalPane(sessionId, initialSize);
      if (activeRef) requestFocus();
      observer = new ResizeObserver(() => {
        if (!activeRef) return; // 隐藏 pane 不参与 fit/resize（ZCode isVisibleRef 守卫）
        scheduleFit("observer");
      });
      observer.observe(host);
      if (initialSize === undefined) requestFit();
    })();
    return () => {
      // 卸载 = 全量回收（ZCode TerminalSession.tsx:1051-1073 dispose 链）。
      disposed = true;
      clearDragThrottle();
      if (resizeRAF !== 0) cancelAnimationFrame(resizeRAF);
      if (focusRAF !== 0) cancelAnimationFrame(focusRAF);
      observer?.disconnect();
      unsubscribe?.();
      terminal?.dispose();
      terminal = null;
      fitAddon = null;
      host = null;
      ready = false;
    };
  });
</script>

<div
  class="relative h-full w-full bg-background{active ? '' : ' hidden'}"
  data-terminal-pane={sessionId}
  data-active={active ? "true" : "false"}
>
  {#if !ready}
    <div
      class="flex h-full items-center justify-center text-xs text-muted-foreground"
      role="status"
    >
      {t("terminal.loading")}
    </div>
  {/if}
  <div bind:this={host} class="h-full w-full p-1"></div>
</div>
