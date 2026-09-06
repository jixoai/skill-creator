# Design: dsh-runtime-integration

```text
DSH composition
  agent-loop + session + tools + system-prompt + presets + approval + API/client
                                  |
                                  v
                          DshRuntimeAdapter
                         handshake / stream / cancel
                                  |
                                  v
                    Skill Steward Manager runtime
             domain tools + snapshot + proposal + approval
```

适配器只依赖官方公开 package seam，并在启动时记录 commit/version、加载的 composition rows、可用 model/preset/permission、session id 和 tool capability。DSH 的 client bundle/remote stream 可以被 Skill Creator 的 Agent 面板适配；Manager projection 不读取 DSH 私有 store。所有工具调用回到 Manager tool registry。

Handshake 失败不是静默 fallback：UI 显示 unavailable reason，deterministic Intelligence 与手工工作流继续可用。只有用户显式选择 DSH 时才启动该 adapter。
