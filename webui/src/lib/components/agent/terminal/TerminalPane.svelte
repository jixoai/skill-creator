<!--
  终端 pane（skills-agent-page 1.6）：xterm.js 挂载面（懒加载 chunk）。
  用户原始需求 [2026-10-03]（design §4）：「前端：xterm.js（webui 依赖新增，
  懒加载 chunk）」。本组件是协议客户端（terminal-client）与 xterm 的接线层：
  onData → writeTerminal（reqId 高水位去重由客户端/服务端协议承载）；输出订阅
  → term.write（seq 有序保证）；reset → 清屏重拉；FitAddon 尺寸 → resize
  （终值幂等）。进程退出 → 退出覆盖层（tab 保留供回看，关闭走 tab x）。
  正交意图：
    [1] xterm 生命周期：动态 import（Terminal + FitAddon + css 懒 chunk），
        ResizeObserver → fit → resize 协议帧，卸载 dispose。
    [2] 协议接线：订阅/写入/清屏；creating 态占位（create ack 未达时禁输入）。
  妥协声明：主题跟随 shadcn token（前景/背景/光标），非完整主题系统。
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import {
    resizeTerminal,
    subscribeTerminal,
    terminalState,
    writeTerminal,
  } from "./terminal-client.svelte";

  let {
    sessionId,
  }: {
    sessionId: string;
  } = $props();

  let host = $state<HTMLElement | null>(null);
  /** 终端进程是否已退出（覆盖层依据；tab 由 dock 管理）。 */
  let exited = $state<number | null>(
    terminalState.tabs.find((tab) => tab.sessionId === sessionId && !tab.alive)?.exitCode ?? null,
  );
  let ready = $state(false);

  onMount(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    // 懒加载 chunk：xterm 家族只在首个 pane 挂载时进入 bundle。
    void (async () => {
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
      const terminal = new Terminal({
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        cursorBlink: true,
        theme: {
          foreground: token("--foreground", "#e4e4e7"),
          background: token("--background", "#09090b"),
          cursor: token("--primary", "#10b981"),
          selectionBackground: "#3f3f46aa",
        },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(host);
      try {
        fit.fit();
      } catch {
        /* 容器未布局（display:none 的 drawer 态）：首个 ResizeObserver 回调补 fit */
      }
      ready = true;
      terminal.onData((data) => {
        writeTerminal(sessionId, data);
      });
      unsubscribe = subscribeTerminal(sessionId, (event) => {
        if (event.kind === "data") terminal.write(event.data);
        else if (event.kind === "reset") terminal.reset();
        else exited = event.exitCode;
      });
      const applySize = (): void => {
        try {
          fit.fit();
          const dimensions = fit.proposeDimensions();
          if (dimensions && dimensions.cols > 1 && dimensions.rows > 1) {
            resizeTerminal(sessionId, dimensions.cols, dimensions.rows);
          }
        } catch {
          /* 未布局态忽略 */
        }
      };
      observer = new ResizeObserver(applySize);
      observer.observe(host);
      applySize();
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
      observer?.disconnect();
      host = null;
      exited = null;
      ready = false;
    };
  });
</script>

<div class="relative h-full w-full bg-background" data-terminal-pane={sessionId}>
  {#if !ready}
    <div
      class="flex h-full items-center justify-center text-xs text-muted-foreground"
      role="status"
    >
      {t("terminal.loading")}
    </div>
  {/if}
  <div bind:this={host} class="h-full w-full p-1"></div>
  {#if exited !== null}
    <div
      class="absolute inset-0 flex items-center justify-center bg-background/80 text-xs text-muted-foreground"
      role="status"
    >
      {t("terminal.exited", { code: exited })}
    </div>
  {/if}
</div>
