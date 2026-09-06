# Design: skill-steward-runtime

```text
Fixture/DSH/Codex adapter
          | handshake + events + tool requests
          v
Manager steward runtime
  snapshot -> domain tool registry -> finding/proposal
             -> validation -> approval -> apply -> audit
          |
          v
Workspace.Provider (only Manager-owned path authority)
```

Adapter 只产生事件和请求，不接收路径或文件句柄。工具 registry 根据 run snapshot 解析 opaque skill IDs；只读工具可返回 bounded content，proposal 工具只创建 draft。apply 与 rollback 在 Manager 内重新 canonicalize root、校验 revision、执行 atomic write/remove，并在 rediscover 后记录结果。

Fixture adapter 必须能注入：valid response、malformed response、stale revision、disconnect、cancel、late event、approval replay。每种注入都必须有确定性 transcript 和 focused test。

事务唯一详细合同是 `transaction-contract.md`。validation 不授予权限；只有人类批准 RPC 可以创建 Manager grant。多文件 apply 是持久 journal 和补偿流程，补偿失败进入 recovery-required。不得宣称普通文件系统提供跨文件 ACID。主规格在实现验收前不提前同步。
