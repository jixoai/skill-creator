# Tasks: acp-agent-bridge

## 1. 引入 `@agentclientprotocol/sdk` 依赖

- [x] 1.1 在根 `package.json` 增加运行时依赖 `@agentclientprotocol/sdk`（pin 次版本，仅 zod peer）；`pnpm install` 通过
- [x] 1.2 验证 SDK 既有导出可用：`acp.client`、`AcpServer`、`createNodeWebSocketUpgradeHandler`、`ndJsonStream`（在 `src/daemon/acp-bridge-service.ts` 顶部 import，`pnpm check` 类型检查通过）
- [x] 1.3 验证零额外运行时依赖（`pnpm why` 确认 SDK 不拉入除 zod peer 外的运行时包）

## 2. Agent discovery 模块（探测 PATH 中已知二进制）

- [x] 2.1 在 `src/daemon/acp-bridge-service.ts` 内（或独立 `agent-registry.ts`）实现 `KNOWN_ACP_AGENTS` 常量与 `discoverAgents()`：用 `node:child_process` 的 `which`/`where`（跨平台）探测 claude/codex/gemini/goose/opencode/qwen-code/kimi-cli/kiro-cli
- [x] 2.2 结果含 `{ id, label, vendor, binaryPath, available }`；首次调用后缓存到 daemon 生命周期内
- [x] 2.3 探测失败的条目降级为 `available: false`，不抛错
- [x] 2.4 单测：mock `which`，断言已装/未装混合场景的 `available` 投影正确（`pnpm test -- acp-bridge`）

## 3. ACP session 契约（`acp.agents.list` / `acp.session.open` / `acp.session.close` + session 事件）

- [x] 3.1 新增 `src/shared/contracts/acp.ts`：`AcpAgentSchema`（`id/label/vendor/binaryPath/available`）、`AcpSessionOpenInputSchema`（`agentId` + `WorkspaceProviderTargetSchema`）、`AcpSessionOpenResultSchema`（`sessionId`）、`AcpSessionIdSchema`、`AcpSessionEventSchema`（判别联合 `{ type: "exited", sessionId, code }`）。session 事件经 WS 推送，浏览器渲染不缓存历史到 memory。
- [x] 3.2 在 `src/shared/rpc-contract.ts` 增 `acp` 命名空间：`agents.list`（input `{}`，output `{ agents: AcpAgentSchema[] }`，daemon 生命周期缓存）、`session.open`、`session.close`，复用 `RpcErrorDefinitions`（spawn 失败用 `UNAVAILABLE`）。session 生命周期全部 daemon RPC 驱动。
- [x] 3.3 `pnpm check` 通过（WebUI 从契约推导类型，不维护第二份）

## 4. 子进程池 + stdio↔WS 桥接（daemon 持有 session 状态）

- [x] 4.1 在 `src/daemon/acp-bridge-service.ts` 实现子进程池 `Map<sessionId, { proc, stream, root, agentId }>`：`session.open` 时解析 `WorkspaceProviderTarget` 得 root（复用 workspace-registry），以 root 为 `cwd` spawn agent，`ndJsonStream` 包裹 stdio。**session 状态（messages / tool_calls / plans）由 daemon 持有**，浏览器经 WS 推送渲染、不存前端 memory。
- [x] 4.2 sessionId 用 opaque token（复用既有 `opaquePathId` 风格生成器，前缀 `acp`）；sessionId 作为视图状态编码到 URL（Creator 编辑 Tab 的 search param，如 `?session=acp_xxx`），刷新可恢复指向。
- [x] 4.3 子进程异常退出 → 发 `{ type: "exited", sessionId, code }` 事件（经 oRPC 事件流 / WS 推送）并清理池条目；浏览器收到后渲染「session 已结束」，不缓存历史。
- [x] 4.4 WS 桥接：浏览器 WS 帧 → agent stdin；agent stdout 帧（`sessionUpdate`：message_chunk / tool_call / plan / thought_chunk）→ 浏览器 WS 推送；文件操作帧在第 5 组的安全门拦截。浏览器收到推送即渲染，**不把会话历史累加进前端全局 `$state` 或 localStorage**。
- [x] 4.5 同 sessionId 重连先踢旧 WS 连接（agent 子进程不重启）；重连后由 daemon 重新推送当前可见会话视图，浏览器不依赖前端 memory 恢复。
- [x] 4.6 单测：用 mock agent 子进程（echo 脚本）验证帧双向透传、`session/prompt` → `sessionUpdate` 顺序保持；断言浏览器侧不缓存会话历史到 memory（mock WS 推送计数 + 重新连接后视图来自 daemon）。

## 5. 安全门（readTextFile / writeTextFile containment 拦截）

- [x] 5.1 在 stdio→WS / WS→stdio 的帧处理里识别 `readTextFile` / `writeTextFile` 请求帧，不透传给 agent fs，由 daemon 代为执行
- [x] 5.2 `readTextFile`：`path.resolve(session.root, path)` → `assertPathInside(session.root, resolved)`（复用 `path-safety.ts`）→ `fs.readFile(resolved, "utf8")` 回传
- [x] 5.3 `writeTextFile`：containment 通过后调用既有 `atomicWriteUtf8`（temp 0600 + rename）
- [x] 5.4 越界路径向 agent 回错误响应（不读不写、不泄露内容），session 不被终止
- [x] 5.5 单测：agent 试图读 `~/.ssh/config`、`../escape`、绝对路径 `/etc/passwd` 全部被拒；root 内读写成功；writeTextFile 走原子写（断言 temp → rename 路径被调用）

## 6. Daemon 生命周期集成（stop coordinator 杀 agent）

- [x] 6.1 在 `main.ts` 的 daemon stop 流程注册 ACP bridge teardown：遍历池 `SIGTERM` → 有界宽限（2s）→ `SIGKILL`
- [x] 6.2 在进程 `exit` / `uncaughtException` 钩子里兜底再杀一遍
- [x] 6.3 teardown 在宽限期内完成，不无限阻塞 daemon 退出
- [x] 6.4 focused test：起多个 mock agent 子进程，触发 daemon stop，断言全部被杀且 daemon 在宽限内退出

## 7. WebSocket 端点 `/ws/acp/<sessionId>` 复用 token 鉴权

- [x] 7.1 在 `web-server.ts` 的 `handleUpgrade` 增 `/ws/acp/` 分支：先验 `token === webToken`（401 失败），再验 sessionId 存在（404 失败），通过后注册 WS 桥接
- [x] 7.2 与既有 `/ws/rpc` 分支同构，不重写既有 WS server
- [x] 7.3 单测：错误 token → upgrade 被拒；不存在 sessionId → upgrade 被拒；正确 token + 存在 sessionId → 桥接建立

## 8. 端到端测试与门禁（含状态分层）

- [x] 8.1 多 session 测试：同时打开 3 个 AI 会话（不同 agent / 不同 workspace root），各自独立桥接、互不串扰；关闭其一不影响另两个
- [x] 8.2 优雅降级测试：选定 agent 二进制不存在 → `session.open` 返回 `UNAVAILABLE`，daemon 不崩溃，其它会话正常
- [x] 8.3 agent 越界综合测试：agent 在对话中尝试写 root 外路径 → 被安全门拒，对话继续在 root 内工作
- [x] 8.4 生命周期综合测试：Tab 关闭 → `session.close` → 子进程被杀；daemon stop → 全部子进程被杀
- [x] 8.5 状态分层测试：浏览器侧不缓存 ACP 对话历史 / tool_call / plan 到前端 memory 跨渲染周期（mock WS 推送 + 重新连接后视图来自 daemon 推送，非前端 memory）；session 内容不写 localStorage；sessionId 在 URL search param，刷新可恢复指向（session 仍存活时重新连 WS）
- [x] 8.6 `pnpm check`（test + typecheck + webui check + fmt）全绿
