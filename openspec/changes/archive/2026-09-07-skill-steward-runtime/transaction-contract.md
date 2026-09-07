# Manager Transaction Contract

原始需求（2026-09-06）：Agent 成为技能管家，分析、禁用、优化、拆分和合并 skills。本文固定事务、恢复和证据边界，任务 2.3 按本文拆步实现。

## Authority

```text
Agent -> propose -> validate -> validation report (NO authorization)
Human UI principal -> approve(proposalId, fingerprint) -> Manager stores grant
Human UI principal -> apply_proposal(proposalId) -> Manager consumes matching grant
Manager -> journal -> mutations -> rediscover -> audit
Human UI principal -> rollback(auditId) -> reverse plan -> same approval/apply path
```

validation 绝不产生授权。批准只能来自已鉴权的人类 UI RPC；模型工具不能获取、传递、伪造或消费 human grant，也没有 `apply_proposal` 或 `rollback` 工具。只有带明确 human principal 的 UI RPC（以及 Manager 内部恢复代码的显式 operation principal）可以消费 grant。DSH permission granted 与 Manager proposal approved 是不同事实。grant 绑定 run、snapshot、完整 patch fingerprint、全部输入 revision、目标 absent precondition。锁内先消费 grant，再启动 apply；重复/并发调用最多一项执行。

`skills.rollback(auditId)` 只准备 reverse proposal。Agent 或没有 human principal 的调用均不能触发 rollback；UI 仍必须经过反向方案审批。取消 run、撤销 proposal、daemon restart 均使未消费 grant 失效；已进入 apply 的操作必须完成 journal 收尾或补偿，不能因取消而丢弃账目。

## Snapshot And Proposal

- 同一次读取的字节计算 revision，并供 analyzer 和 Agent 使用；禁止 analyze A、复制 B、propose 时观察 C 的隐式重新绑定。任何内容变化都要求新 snapshot 和新审批。
- 首版每个 run 一个 Workspace.Provider；可选其中一个或多个 skill。Global 支持只读分析与批准后的 disable，Global edit/split/merge 返回 unsupported-write-scope，提供复制到 Imported 的恢复入口。
- 总内容最多 2 MiB、每 skill 256 KiB、每 run 100 skills；超过限制明确拒绝并提示缩小范围，不静默截断。相对资源清单包含 hash/类型/大小；不自动执行脚本，不跟随目录外 symlink。
- evidence 包含 snapshot、skill、相对文件、行范围或精确片段。确定性 finding 和 Agent semantic finding 分别标记；Agent finding 经 Manager 校验引用后获得 ID。propose 可以提交新 finding evidence，避免只允许旧 analyzer 已知类别而无法优化新问题。
- proposal 修改的已有技能必须等于其声明的 affected identities，且全属于 snapshot；split/merge 的新目标由 server 根据同一 target 下的安全名称派生，绑定 absent precondition，不伪造已有 skill id。inverse bytes/metadata 由 Manager 保存，不能信任 Agent 提供的 inverse。

## Mutations

| Action  | Apply                                                                                 | Rollback                                                 |
| ------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| edit    | 校验原 revision，写新文档，保留未知合法 frontmatter 和配套资源                        | 仅当前状态等于 apply 后 revision 时恢复原字节            |
| disable | 保存启停状态并调用 Provider 真实启停机制；不能仅改变 UI flag                          | 恢复原启停状态，校验启停状态也未漂移                     |
| split   | 同一 target 创建 >=2 个不存在的目标，复制显式资源映射；校验后禁用原 skill，保留源目录 | 删除仍与 apply 后 hash 一致的目标，恢复原 skill 启停状态 |
| merge   | 同一 target 创建合并目标；验证引用和资源冲突映射后禁用所有源，保留源目录              | 校验所有 postconditions，再删目标、恢复源启停状态        |

文件夹资源不能只处理 SKILL.md。源技能已有 scripts/references/assets 时，UI diff 必须显示复制/保留/冲突及重新指向的引用。遗漏必要资源的 patch 不得批准。删除源文件不是 merge 的默认行为。

## Failure And Recovery

普通文件系统不能提供跨目录 ACID。按单 proposal 实现持久 journal + 排他 Manager mutation queue + 补偿；多个 proposal 分别批准、分别记账，不承诺 run 级原子性。外部编辑器不受 Manager 锁控制，每步写入及补偿前均重查 preconditions。

提交前持久化 before/after manifest、资源备份、grant consumption 和 operation index。每步记账并持久化，再推进下一步。普通失败补偿到原状态；补偿遇到外部修改或 I/O 错误时进入 recovery-required，保留 journal/backups、封锁该 target 后续 mutation、显示逐项事实。不能把部分成功投影成 completed，也不能覆盖外部修改来强行回滚。

重启先扫描未完成 journal，再开放 target 写入。不同 operation index 注入 kill 后可恢复或明确 recovery-required。活跃模型会话重启后标 interrupted，不自动重放写操作或复用旧授权。terminal audit 和 inverse manifests 保留供用户显式清理，不能像短期 transcript 一样按 20 条自动淘汰。

## Negative Fixtures

每个测试只改变一个变量：合法 split 的 directoryName 改成 ../escape；合法 target 路径在预检后替换成 symlink；合法 proposal 改 snapshotId；分析后修改 skill；并发两次批准/应用；第二次写失败；补偿前外部改文件；journal 写失败；daemon 在每个写边界退出。均断言 Provider 字节/启停/资源树及 audit 终态，不只断言错误消息。
