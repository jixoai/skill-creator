# 4.8 clean-install 取证（消除 ccski link: / 安装态启动）

生成器：`scripts/clean-install-check.sh.ts`（可复现：仓库根执行 `bun scripts/clean-install-check.sh.ts`）。
原始证据：`artifacts/clean-install.json`（本文件为结构化结论 + 根因记录）。

## 结论

`npm pack` 产物在**仓库外空目录**用真实 `npm install <tarball>` 安装成功并以黑盒方式完成
start → status → HTTP 探针 → stop → restart → stop 全生命周期；DSH 组合宿主 mounted（149 entries，
含 vendored `@skill-creator/dsh-client`），`/api/health`、`/manager/dsh-island.js`、DSH 端口活性全部通过。
不再以 build / pack --dry-run 作为可安装证据。

| 维度                                     | 结果                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| npm install（仓库外空目录，npm 11.19.0） | exit 0（旧 `ccski: link:../ccski` 在此处静默 exit 1，已消除）                                                                       |
| 安装树 `ccski` 泄漏                      | 无（`node_modules/ccski` 不存在；`dist/daemon.js` 无 `ccski` import 残留）                                                          |
| `@deepseek-ai/dsh-base` 从安装包可解析   | 是                                                                                                                                  |
| 资产在位                                 | `dist/cli.js`、`dist/webui/index.html`、`dist/webui/dsh-island.js`、`dist/dsh-client/lib/client.js`、`dist/dsh-client/package.json` |
| daemon start（headless+web，隔离 HOME）  | exit 0                                                                                                                              |
| DSH host                                 | mounted；entries=149；activation 含 `@skill-creator/dsh-client`                                                                     |
| HTTP                                     | `/api/health` 200 ok；`/` 401（DSH host 经代理应答，非 SPA 恢复面）；`/manager/dsh-island.js` 200 JS；DSH 端口存活                  |
| stop → restart → stop                    | endpoint 释放确认；重启后 DSH 重新 mounted                                                                                          |
| tarball                                  | `skill-creator-2.0.0.tgz`，96 entries                                                                                               |

## 打法（依法打入产物）

1. **ccski 打入产物**：`scripts/build-core.sh.ts` 从 `packages: "external"` 改为显式
   `external = dependencies - {ccski}`；ccski（及其唯一依赖 `debug@4.4.3`）inline 进
   `dist/daemon.js`。根 `package.json` 的 `ccski: link:../ccski` 从 dependencies 移到
   devDependencies（仅作构建期 bundling 源，不进发布依赖清单）。
   esbuild ESM 输出需 banner 提供 `createRequire`（ccski→debug 的 CJS `require("tty")`）。
2. **runtime @deepseek-ai 包归位 dependencies**：`dsh-app-boot`、`dsh-base`、`dsh-web-app`、
   `dsh-host-webserver`、`dsh-client-modules`、`dsh-host-frontend-static`、`dsh-web-frontend`、
   `dsh-client-connection`、`dsh-credentials`、`dsh-credentials-local`、`cordis-plugin-loader`
   原在 devDependencies（pnpm 根 node_modules 语义下可用），安装态全部改为真实 dependencies。
3. **Manager DSH client plugin vendor**：构建复制 `packages/skill-creator-dsh-client` 到
   `dist/dsh-client/`（含 package.json + LICENSE）；daemon 在安装态把该目录链接进
   cordis loader 的解析路径（见根因 2）。
4. **Node 版本锁定**：`engines.node >= 22.13.0`（原 `>=20.0.0`）。实测依据：DSH
   `dsh-code-runtime-worker-thread` 使用 `node:module` 的 `stripTypeScriptTypes`
   （Node 22.13.0 引入）。DSH 官方包自身未声明 engines；本锁定由安装态实测得出
   （验证于 node v24.20.0）。

## 根因记录（drill 实测暴露的三个真实缺陷）

1. **npm 版本分裂**：`@deepseek-ai/dsh-agent-tool-presentation@0.1.0-rc.6` 独占
   `dsh-invariants@0.1.0-rc.8`，其余树统一 `0.1.2-rc.1`——npm 在
   `skill-creator/node_modules/@deepseek-ai/` 下嵌套一整套副本，双实例破坏 DSH 树。
   修复：对齐 `dsh-agent-tool-presentation@0.1.2-rc.1`（其依赖仅 `schemastery`，
   与 0.1.2-rc.1 家族一致）。该包仅被官方 `ptc` preset row 运行时引用，无源码直接 import。
2. **cordis loader 的 row 解析路径**：loader 以**自身模块位置**（不是我们传入的 boot
   baseUrl）parent-walk 解析 row 包名。pnpm 虚拟 store 位于根 `node_modules/.pnpm/...`，
   上行可达根 `node_modules/@skill-creator/dsh-client`（workspace 链接），因此 dev 一直可用；
   npm 把依赖铺在消费者 `app/node_modules`，vendored 插件不在该路径上 →
   `ERR_MODULE_NAMED '@skill-creator/dsh-client'`。修复：安装态（bundle 模式且父目录名为
   `node_modules`）把 `dist/dsh-client` 链接（失败退化拷贝）到消费者
   `node_modules/@skill-creator/dsh-client`——目标始终是本安装包内部目录，无本地源码依赖。
   `dsh-official-profile.ts` 的 `repoRoot` 同时修正为 bundle 感知（`dist/daemon.js` 的
   包根 = 上溯一级，原实现上溯三级指向包外；此前 4.1 生产运行靠 boot baseUrl 的
   parent-walk 碰巧遮蔽了该错误）。
3. **取证工具自身的 Bun/node 混淆**：drill 首版用 `process.execPath` 启动已安装 CLI——
   脚本跑在 Bun 下，Bun 的 `node:module` 缺 `stripTypeScriptTypes`，制造了假缺陷。
   修复：黑盒驱动固定用 PATH 上的真实 `node`，evidence 的 nodeVersion 也改为实测
   `node --version`（非 Bun 兼容串）。

## License 清单

| 组件                                         | License             | 形态                                           |
| -------------------------------------------- | ------------------- | ---------------------------------------------- |
| skill-creator                                | MIT                 | 发布包本体                                     |
| ccski 2.4.0（jixoai-labs）                   | MIT                 | 连同 `debug@4.4.3`（MIT）打入 `dist/daemon.js` |
| @deepseek-ai/dsh-base / cordis（代表闭包）   | MIT                 | npm registry 安装                              |
| dist/dsh-client（@skill-creator/dsh-client） | MIT（随包 LICENSE） | vendored 目录                                  |

## 未验证项

- Windows 符号链接受限环境下消费者路径链接的拷贝退化路径（本机 darwin arm64 仅验证
  symlink 分支；退化逻辑 `fs.cpSync` 为同一目标的等价实现）。
- 全局安装（`npm i -g`）形态：drill 验证的是本地依赖安装形态（bin 链接布局不同，
  loader-path 链接逻辑相同）。
