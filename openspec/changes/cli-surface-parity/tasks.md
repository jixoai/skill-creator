# Tasks: cli-surface-parity

## 1. spec

- [ ] 1.1 立 change（proposal/design/tasks + `cli-manager-surface` delta）并通过
      `openspec validate --strict`

## 2. skills 族

- [ ] 2.1 引用解析助手（wsRef/pRef/skillRef；歧义列候选 exit 2）+ `skills list`
      （`--provider`/`--all`/`--json`）
- [ ] 2.2 `skills info` / `validate`（退出码按 valid 投影）
- [ ] 2.3 `skills toggle`（复数 ref；conflict 行忠实投影）
- [ ] 2.4 `skills duplicates`
- [ ] 2.5 `skills update check` / `update apply`（显式作用域；partial 汇总忠实）

## 3. model 族 + setup 参数

- [ ] 3.1 `model list` / `routes`（key 不回显明文）
- [ ] 3.2 `model use`（目录自动补路由；effort 校验）
- [ ] 3.3 `model route add` / `route remove`（整表替换；remove 活动路由拒绝）
- [ ] 3.4 `model key set`（支持 `-` stdin）/ `key clear`
- [ ] 3.5 `model test`（typed failed 不抛）
- [ ] 3.6 `setup --model` 参数段（D5 顺序；`none` key 语义；失败 exit 1 不回滚）

## 4. 测试与文档

- [ ] 4.1 spawn 沙箱集成测试：解析矩阵 + skills 族（D6 前四块）
- [ ] 4.2 model 族 + setup --model 端到端（D6 后两块）
- [ ] 4.3 `skills/skill-creator-v2/references/tools.md` CLI 表补全
- [ ] 4.4 门禁：focused tests + typecheck + fmt + `git diff --check` + full build
