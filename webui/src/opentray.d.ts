/** 原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」；意图：[1] 声明页面侧原生窗口 bridge；[2] 将非原生宿主表达为可选能力。 */

declare global {
  /** 原生宿主返回的逻辑像素矩形。 */
  interface OpentrayRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  /** 原生窗口控件区域变化事件。 */
  interface OpentrayGeometryChangeEvent {
    titlebarAreaRect: OpentrayRect;
  }

  /** 原生标题栏 overlay 能力。 */
  interface OpentrayWindowOverlay {
    /** 获取 OS 窗口控件簇（macOS 红绿灯 / Windows caption 按钮）占据的区域。 */
    getTitlebarAreaRect(): Promise<OpentrayRect>;
    /** 监听控件簇几何变化（平台重排）。返回 unsubscribe。 */
    listen?(
      type: "geometrychange",
      cb: (e: OpentrayGeometryChangeEvent) => void,
    ): Promise<() => void>;
    addEventListener?(type: "geometrychange", cb: (e: OpentrayGeometryChangeEvent) => void): void;
    removeEventListener?(
      type: "geometrychange",
      cb: (e: OpentrayGeometryChangeEvent) => void,
    ): void;
  }

  /** 页面可调用的原生窗口能力。 */
  interface OpentrayWindowBridge {
    overlay?: OpentrayWindowOverlay;
    /** 启动原生窗口拖拽（pointer 事件坐标）。 */
    startAppRegionDrag?(opts: { x: number; y: number; pointerId: number }): Promise<void> | void;
    stopAppRegionDrag?(opts: { pointerId: number }): Promise<void> | void;
    /** 调整原生窗口尺寸。 */
    resizeTo?(width: number, height: number): Promise<void> | void;
    /** 查询窗口可见性。 */
    isVisible?(): Promise<boolean> | boolean;
    /** 显示窗口。 */
    show?(): Promise<void> | void;
    /** 隐藏窗口。 */
    hide?(): Promise<void> | void;
    /** 关闭窗口（retained session 隐藏，不销毁页面运行时）。 */
    close?(): Promise<void> | void;
    /** 恢复 retained session。 */
    toVisible?(): Promise<void> | void;
    /** 最小化窗口。 */
    minimize?(): Promise<void> | void;
    /** 最大化窗口。 */
    maximize?(): Promise<void> | void;
    /** 从最大化/最小化恢复。 */
    restore?(): Promise<void> | void;
    /** 查询窗口状态。 */
    getWindowState?():
      | Promise<{ state: "normal" | "minimized" | "maximized" }>
      | { state: "normal" | "minimized" | "maximized" };
  }

  /** 兼容 OpenTray namespace 形态的窗口入口。 */
  interface OpentrayNamespace {
    window?: OpentrayWindowBridge;
  }

  /** OpenTray 注入到浏览器 Navigator 的可选能力。 */
  interface Navigator {
    opentrayWindow?: OpentrayWindowBridge;
    opentray?: OpentrayNamespace;
  }
}

export {};
