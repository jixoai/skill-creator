# Design: steward-product-workflow

```text
DSH Web host
      |
      v
Skill Creator client plugin
  Workspaces / Creator / Repository / Steward
      |
      v
  scope + task + runtime config
              |
     timeline + findings + diff
              |
     validate -> approve -> apply
              |
        audit / rollback
```

Steward 是 DSH Web host 中的 Skill Creator client plugin，不在 Creator 页面复活通用 ACP 聊天，也不另起 iframe。运行事件来自 Manager-owned projection；DSH session transcript 作为可折叠上下文显示。高风险操作默认停在 approval，冲突与 stale 显示实际 revision 和恢复动作。窄窗口把 runtime 配置和事件详情收进 drawer/sheet，但不隐藏当前任务状态。
