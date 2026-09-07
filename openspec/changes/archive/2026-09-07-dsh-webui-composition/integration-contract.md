# DSH Web Composition Contract

原始需求（2026-09-06）：把 skill-creator-webui 和 dsh-webui 合并，重点复用 Agent 配置与交互面板。本文是具体工程决策，不意味着用户要求重写所有 Manager 页面。

## Verified Source

官方 `deepseek-ai/deepseek-harness` commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`：

| Source path                                     | Contract and consequence                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/client/web/src/boot.ts`               | AppWebEntry.run/dispose；读取宿主注入的 **DSH_BOOT** 与 **ModuleLoader**；不能只 new AppWebEntry 就宣称集成 |
| `packages/client/modules/src/index.ts`          | 从 Loader 插件包的 dsh.client 元数据和 ./client export 生成浏览器模块图                                     |
| `packages/client/ui-layout/src/client/index.ts` | root/sidebar/conversation/details slots；替换父 slot 会移除它声明的子 slot，必须显式重新声明                |
| `packages/client/ui-chat/src/client/apply.ts`   | session/slots/uiSession/uiConversation/layout/remote 等依赖；ChatView 不是无上下文 React 组件               |
| `packages/client/web/src/seed.ts`               | React/ReactDOM/Cordis 等单实例 module table；不能在插件里再 bundle 一份 React                               |
| `packages/boot/app-boot/src/profile.ts`         | web profile = dsh-base + dsh-web-app；profile 插件配置是可信代码，不能由 skill 正文指定                     |

这些是锁定 commit 中的源码 seam，不是对 npm 发布形态或外部应用嵌入 API 的承诺。`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-client-web` 等名称在任务 0.1 完成前只能视为待核验候选；实现不得根据名称猜测 export、peer dependency、browser entry 或安装方式。

## Package Fact Gate

在任何 Web host 或 client plugin 实现前，必须从锁定 commit 的 package manifest、`exports`、`peerDependencies`、构建脚本和实例测试取得事实，并完成一次真实消费验证：

```text
manifest/export/type facts
          |
          +--> clean install from published artifact
          |       or reproducible commit tarball/workspace pack
          v
actual AppWebEntry + loader + client module graph
```

任务必须记录每个实际依赖的 package name、版本/commit、entry、peer dependency、构建产物和加载结果。若包未发布、exports 不可消费或 peer graph 无法在干净目录复现，必须输出 typed `unavailable` 和可执行恢复路径；不得改用猜测的高层 API、私有源码路径、ACP 或静态页面伪造“集成成功”。

## Chosen Composition

DSH web boot + Skill Creator root layout plugin 作为统一入口。保留当前 Manager daemon 和其唯一 WorkspaceRegistry；DSH runtime 由 daemon 生命周期创建/销毁，默认不连用户现有 DSH profile、不修改其 ~/.dsh。模型配置在应用自己的 DSH home 中保存，凭证不进入 run snapshot、日志、前端 localStorage 或审核附件。

客户端保留 DSH session/chat/settings/model/permission 插件。Skill Creator root layout 用一个 React slot 外壳提供 Manager 导航与 Agent 区域；原有 Workspaces/Creator/Repository 视图用一个 Svelte mount/unmount island 复用。先把 SvelteKit 专属 goto/page 依赖压到 navigation adapter；其余 stores/components 不批量重写。island 只能拥有分配给它的 DOM，DSH React 与 Svelte 不共同管理一个 DOM 子树。

仅一个 root、一个外层路由 owner、一个 Manager connection owner。DSH session id 和 Manager run id 是关联键，不互相代替。关闭页面只 detach 视图；cancel 由明确动作触发。换 session 不能重建 Manager registry、刷新丢失 Creator dirty draft或丢失待审批 proposal。

## Transport Gate

复用 DSH 官方 client-modules/host-webserver 来生成 boot graph 和 plugin assets；不要手写其私有 boot wire。一个 loopback origin 下保留 Manager `/ws/rpc`，DSH remote 使用官方 API route。宿主接入通过实际 host 插件接口实现并记录版本；当前 daemon static fallback 必须在 API/plugin routes 之后。Manager auth 和 DSH browser auth 各自执行，不能因为 loopback 或代理已鉴权就绕过另一方的 Origin/Host/token 校验。

task 1.1 必须交付实际 boot graph、官方 settings 面板、一个原有 ProviderView 和一个 session transcript 同屏的最小运行证据。若源码接口无法支持上述装配，提交具体失败、源代码位置和替代 composition 给独立 Codex 复核后修订 design；不允许退回 ACP 或用假 settings UI 完成该任务。

## Acceptance Interactions

| Action                       | Required evidence                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| 首次无凭证打开               | Manager 可用，Steward 明确待配置；官方 model settings 可编辑并重启保留，屏幕/日志不泄露 key |
| 修改 model/profile           | 下一 run 使用新配置，旧 run 保留脱敏配置 revision；不能悄悄换模型                           |
| 同一页面往返 Manager/Steward | dirty draft、selected skills、session id 保留；无第二 root、iframe、重复 WS owner           |
| Agent tool request           | DSH transcript 的 call id 关联 Manager tool event；工具列表只有领域白名单                   |
| Approve                      | DSH permission interaction 不等于 Manager human approval；未审批时真实 Provider 字节不变    |
| Plugin/daemon stop           | disposed 后无旧回调提交；Manager-only 恢复入口可达，重启回放 audit                          |

Manager-only 恢复视图可以继续使用现有静态 SPA，但它只是 DSH 不可用时的管理器恢复入口：不得显示 Agent/session/chat，也不得被验收为第二个 Agent shell。正常状态只有一个 DSH-hosted Agent 入口；生产包必须包含两种启动状态所需的实际资源。DSH UI 合并完成以后，下一阶段负责完整产品流程验收。
