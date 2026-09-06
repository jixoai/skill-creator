# dsh-webui-composition verification（进行中）

记录日期：2026-09-06。

## 已完成任务

| Task | 提交 | 证据 |
| --- | --- | --- |
| 0.1 web composition 事实与版本锁定 | c35e799 | 事实表（research 文档）+ 契约（DSH_WEB_LOCKED_PACKAGES / typed unavailable）+ 安装面（webui devDeps 浏览器面 / 根 devDeps dsh-web-app）+ test/dsh-web-composition.test.ts 6 passed |

## 关键实测事实（后续任务的约束）

1. DSH web shell 是 React 构建（react/react-dom 19 + css modules）；Skill Creator 的 Svelte 组件不能直接进 slots——host/island（3.1a）或同形态 client 插件（1.2）。
2. `/client` 子入口是 `window.__ModuleLoader__.load({id, factory})` 工厂模块：只能进官方 shell 的模块加载器，Node 下不可执行（预期形态）。
3. `dsh-client-web` 声明 peer 仅有 cordis；真实 import 面 = react 系 + cordis-plugin-loader + client-store/ui-primitives/ui-slots。缺失 → 浏览器 module-not-found → typed unavailable（MISSING_PEER）。
4. `dsh-web-app` exports `./startup`（host 启动 seam）与 `./cordis.patch.yml`（profile patch 通道）；72 直接依赖全家桶，daemon 不应整体引入——1.1 只复用 startup/boot seam。
5. koffi（directory-picker-native 的 FFI）构建脚本显式拒绝：本仓不用原生目录选择器。

## 门禁状态

- 全量 `pnpm test` 354/354（44 files）；`pnpm typecheck` 0 错；`pnpm --dir webui check` 0/0；fmt/diff-check 干净；`openspec validate --all --strict` 9/9。
- 1.1 起未完成。
