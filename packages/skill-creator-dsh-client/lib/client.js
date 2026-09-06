// Skill Creator Manager 的 DSH client half（task 1.2）。
// 形态契约：window.__ModuleLoader__.load({id, factory}) —— 仅注册工厂；
// 一切副作用（含未来 UI/CSS）都在 factory 闭包内、首次 materialize 时执行。
window.__ModuleLoader__.load({
  id: "@skill-creator/dsh-client",
  factory: (require) => {
    void require;
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // 唯一的 Manager RPC owner（task 1.2 acceptance：plugin 只建立一个 RPC owner）。
    // 传输接线（daemon loopback / DSH connection channel）属 3.1a；此处先固化
    // 单例与生命周期语义：懒建立、进程内唯一、dispose 由 DSH lifecycle 驱动。
    var owner = null;
    var acquisitions = 0;
    function getManagerRpcOwner() {
      acquisitions += 1;
      if (owner === null) {
        owner = {
          kind: "skill-creator-manager",
          createdAt: new Date().toISOString(),
        };
      }
      owner.acquisitions = acquisitions;
      return owner;
    }
    function disposeManagerRpcOwner() {
      owner = null;
      acquisitions = 0;
    }
    Object.defineProperty(exports, "getManagerRpcOwner", {
      enumerable: true,
      value: getManagerRpcOwner,
    });
    Object.defineProperty(exports, "disposeManagerRpcOwner", {
      enumerable: true,
      value: disposeManagerRpcOwner,
    });
    return module.exports;
  },
});
