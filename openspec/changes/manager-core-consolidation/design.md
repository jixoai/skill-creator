# Design: manager-core-consolidation

## Authority

```text
WebUI / CLI input
       |
       v
shared Zod contract -> RPC router -> daemon domain
                                      |
                                      +-> Registry (Workspace/Provider)
                                      +-> Skill service
                                      +-> Creator service
                                      `-> Repository service
```

WebUI 只发送 opaque IDs 和声明式输入。daemon 根据 registry 和 provider catalog 解析真实路径。Manager 的持久状态不进入 Agent session、localStorage 或 harness 配置文件。

## Work units

1. 盘点当前 RPC、domain service、WebUI caller 和测试，形成一张逐项映射表。
2. 对 shared contracts 做必要的破坏性收敛：每个输入和外部返回先作为 `unknown` 经 `safeParse`；错误使用有限业务错误。
3. 清理过期 active changes。归档目录保留原文件，不让旧 tasks 继续成为实施依据。
4. 为 Manager 建立一条 focused gate，能证明 registry、creator、repository 的关键安全不变量。

## Acceptance evidence

- `openspec validate --all --strict` 通过。
- `pnpm test -- --runInBand` 或仓库等价的串行 focused tests 通过。
- `pnpm typecheck`、`pnpm --dir webui check`、`pnpm build`、`git diff --check` 通过。
- 失败测试能指出具体 invariant，不以空列表掩盖权限、I/O 或路径错误。
