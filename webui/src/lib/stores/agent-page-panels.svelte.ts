/**
 * 用户原始需求 [2026-10-05]：「我测试了三个应该是 toggleButton 的，没有任何
 * 样式效果：AgentPanel 的开关，还有 AgentApp 的 Terminal 和 RightPanel 的
 * 开关。」——terminal/right-panel 的顶栏钮此前是 proxy-click（DOM 爬页面真钮，
 * 无状态源、无按下态）；agent-panel 有语义无按下样式。面板开合态提升为 shell
 * 级共享 store：页面真钮与顶栏开关同源（单一真相），proxy-click 协议退役。
 * 正交意图：
 *   [1] 面板开合态（terminal/rightPanel/narrow 抽屉）+ DevicePrefs 持久化同源。
 *   [2] narrow 布局态（<1024px matchMedia，listener 常驻）——rightPanelVisible
 *       派生的输入；页面挂树抽屉的局部复位仍归页面（watch 本 store）。
 *   [3] agent 页挂载时 syncAgentPagePanelsFromPrefs() 重读持久化真值（组件级
 *       初始化语义保持——测试可按 mount 前写 localStorage 注入初始态）。
 */
import { readDevicePrefs, updateDevicePrefs } from "$lib/shell/device-prefs";

export const agentPagePanels = $state({
  terminalOpen: readDevicePrefs().agentTerminalOpen,
  /** 首开后恒 true（TerminalDock/xterm/PTY 不卸载，关闭只 display:none）。 */
  terminalMounted: readDevicePrefs().agentTerminalOpen,
  rightPanelOpen: readDevicePrefs().agentRightPanelOpen,
  narrowRightPanelOpen: false,
  narrow: false,
});

// narrow 真值不在模块加载时读 matchMedia（布局测试在挂载前才 stub matchMedia；
// 且组件级「挂载时重读」语义要求 per-mount 刷新）——listener 幂等挂接。
let mediaListenerAttached = false;

function ensureNarrowSource(): void {
  if (typeof matchMedia === "undefined") return;
  const query = matchMedia("(max-width: 1023px)");
  agentPagePanels.narrow = query.matches;
  if (!mediaListenerAttached && typeof query.addEventListener === "function") {
    query.addEventListener("change", (event) => {
      agentPagePanels.narrow = event.matches;
    });
    mediaListenerAttached = true;
  }
}

/** agent 页挂载时重读持久化真值 + narrow 布局态（页面局部 $state 时代的
 * 组件级初始化语义保持——测试可按 mount 前写 localStorage/stub matchMedia
 * 注入初始态）。 */
export function syncAgentPagePanelsFromPrefs(): void {
  ensureNarrowSource();
  const prefs = readDevicePrefs();
  agentPagePanels.terminalOpen = prefs.agentTerminalOpen;
  agentPagePanels.terminalMounted = prefs.agentTerminalOpen;
  agentPagePanels.rightPanelOpen = prefs.agentRightPanelOpen;
}

export function toggleAgentTerminal(): void {
  if (!agentPagePanels.terminalOpen) agentPagePanels.terminalMounted = true;
  agentPagePanels.terminalOpen = !agentPagePanels.terminalOpen;
  updateDevicePrefs({ agentTerminalOpen: agentPagePanels.terminalOpen });
}

export function toggleAgentRightPanel(): void {
  if (agentPagePanels.narrow) {
    agentPagePanels.narrowRightPanelOpen = !agentPagePanels.narrowRightPanelOpen;
    return;
  }
  agentPagePanels.rightPanelOpen = !agentPagePanels.rightPanelOpen;
  updateDevicePrefs({ agentRightPanelOpen: agentPagePanels.rightPanelOpen });
}

/** 定位入口（transcript 内链接等）需要面板可见时的单向打开。 */
export function revealAgentRightPanel(): void {
  if (agentPagePanels.narrow) {
    agentPagePanels.narrowRightPanelOpen = true;
    return;
  }
  if (!agentPagePanels.rightPanelOpen) {
    agentPagePanels.rightPanelOpen = true;
    updateDevicePrefs({ agentRightPanelOpen: true });
  }
}
