// Skill Creator Manager 的 DSH client half（task 1.2 → 3.1a 扩展）。
// 形态契约：window.__ModuleLoader__.load({id, factory}) —— 仅注册工厂；
// 一切副作用（含 UI/CSS）都在 factory 闭包内、首次 materialize 时执行。
// 3.1a：向官方 sidebar.footer.action（root-scope list slot）贡献 Manager 入口，
// 点击挂载 Manager island（/manager/dsh-island.js，Svelte mount/unmount，
// 独占其 DOM 子树；DSH React 不共管 island 内部 DOM）。单 connection owner：
// island 的 Manager RPC 由 island bundle 内部的 generation-gated owner 建立，
// 本插件不建立第二个 WS；重复挂载/卸载不重复连接。
window.__ModuleLoader__.load({
  id: "@skill-creator/dsh-client",
  factory: (require) => {
    var React = require("react");

    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // Manager web token 捕获（同源组合入口 ?token=<dsh>#token=<manager>）：
    // DSH shell 启动后会清理地址栏，本工厂在 client combo 加载时立即把 #token=
    // 收进 sessionStorage（与 island rpc-client 的 readWebToken 同键），保证
    // island mount 时凭据可用。
    (function captureManagerToken() {
      try {
        if (typeof window === "undefined" || !window.location) return;
        var hash = (window.location.hash || "").replace(/^#/, "");
        if (!hash) return;
        var params = new URLSearchParams(hash);
        var token = params.get("token");
        if (token) {
          window.sessionStorage.setItem("skill-creator-token", token);
          // 清 hash（Manager token 卫生；不动 query —— ?token= 属 DSH 握手）。
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      } catch (error) {
        console.warn("[skill-creator] manager token capture failed:", error);
      }
    })();

    // 唯一的 Manager RPC owner（task 1.2 acceptance：plugin 只建立一个 RPC owner）。
    // 传输接线（同源 /ws/rpc）由 island bundle 持有；此处固化单例与生命周期语义。
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

    // ---- Manager island 宿主（3.1a）----

    var ISLAND_ASSET_PATH = "/manager/dsh-island.js";
    var islandState = { open: false, scriptLoading: null, hostEl: null, panelEl: null, api: null };

    function loadIslandApi() {
      if (islandState.api) return Promise.resolve(islandState.api);
      if (islandState.scriptLoading) return islandState.scriptLoading;
      islandState.scriptLoading = new Promise(function (resolve, reject) {
        var existing = document.querySelector(
          'script[data-skill-creator-island="' + ISLAND_ASSET_PATH + '"]',
        );
        if (!existing) {
          var script = document.createElement("script");
          script.src = ISLAND_ASSET_PATH;
          script.dataset.skillCreatorIsland = ISLAND_ASSET_PATH;
          script.onload = function () {
            resolve(window.__skillCreatorManagerIsland || null);
          };
          script.onerror = function () {
            reject(new Error("manager island asset failed to load: " + ISLAND_ASSET_PATH));
          };
          document.head.appendChild(script);
        } else {
          resolve(window.__skillCreatorManagerIsland || null);
        }
      }).then(function (api) {
        islandState.scriptLoading = null;
        islandState.api = api;
        return api;
      });
      return islandState.scriptLoading;
    }

    function closeIsland() {
      if (!islandState.open) return;
      islandState.open = false;
      try {
        // unmount 匹配 mount 时的 panel 元素（entry 侧同规则），Svelte root 与
        // Manager 连接随生命周期释放；失败不阻断 host 移除。
        if (islandState.api && islandState.panelEl) islandState.api.unmount(islandState.panelEl);
      } finally {
        if (islandState.hostEl && islandState.hostEl.parentNode) {
          islandState.hostEl.parentNode.removeChild(islandState.hostEl);
        }
        islandState.hostEl = null;
        islandState.panelEl = null;
      }
    }

    function openIsland() {
      if (islandState.open) return;
      islandState.open = true;
      loadIslandApi()
        .then(function (api) {
          if (!api || !islandState.open) return;
          var host = document.createElement("div");
          host.dataset.skillCreatorIslandHost = "true";
          host.style.cssText =
            "position:fixed;inset:0;z-index:70;background:rgba(15,17,21,0.55);" +
            "display:flex;align-items:stretch;justify-content:flex-end;";
          var panel = document.createElement("div");
          panel.style.cssText =
            "width:min(560px,92vw);height:100%;overflow:auto;background:#0f1115;" +
            "box-shadow:-12px 0 40px rgba(0,0,0,0.45);";
          host.appendChild(panel);
          host.addEventListener("click", function (event) {
            if (event.target === host) closeIsland();
          });
          document.body.appendChild(host);
          islandState.hostEl = host;
          islandState.panelEl = panel;
          api.mount(panel);
        })
        .catch(function (error) {
          islandState.open = false;
          // 岛资产不可达（Manager daemon 未提供 /manager/* 等）：入口按失败态呈现，
          // 不静默成功；控制台留痕便于诊断。
          console.error("[skill-creator] manager island unavailable:", error);
        });
    }

    function ManagerFooterAction() {
      return React.createElement(
        "button",
        {
          type: "button",
          "aria-label": "打开 Skill Creator Manager",
          title: "Skill Creator Manager",
          onClick: function () {
            if (islandState.open) closeIsland();
            else openIsland();
          },
          style: {
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 10px",
            border: "none",
            borderRadius: "8px",
            background: "transparent",
            color: "inherit",
            font: "inherit",
            cursor: "pointer",
          },
        },
        React.createElement("span", { "aria-hidden": "true" }, "▤"),
        React.createElement("span", null, "Manager"),
      );
    }

    function apply(ctx) {
      ctx.effect(function () {
        var dispose = ctx.slots.inject("sidebar.footer.action", function () {
          return ctx.slots.register(
            {
              name: "sidebar.footer.action",
              id: "skill-creator-manager",
              locale: "common",
              inject: function () {
                return {};
              },
            },
            ManagerFooterAction,
          );
        });
        return function () {
          closeIsland();
          if (typeof dispose === "function") dispose();
        };
      }, "skill-creator-manager: sidebar footer + island");
    }

    Object.defineProperty(exports, "apply", { enumerable: true, value: apply });
    Object.defineProperty(exports, "inject", { enumerable: true, value: ["slots"] });
    Object.defineProperty(exports, "__internal", {
      enumerable: false,
      value: {
        islandState: islandState,
        openIsland: openIsland,
        closeIsland: closeIsland,
        loadIslandApi: loadIslandApi,
      },
    });
    return module.exports;
  },
});
