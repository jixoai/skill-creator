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
    /** 设置窗口样式（opacity / keepOnTop 等）。 */
    setStyle?(style: Record<string, unknown>): Promise<void> | void;
    /** 查询窗口可见性。 */
    isVisible?(): Promise<boolean> | boolean;
    /** 显示窗口。 */
    show?(): Promise<void> | void;
    /** 隐藏窗口。 */
    hide?(): Promise<void> | void;
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
