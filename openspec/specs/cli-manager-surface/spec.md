# cli-manager-surface Specification

## Purpose

CLI 与 WebUI 同源的技能管理与模型配置面（cli-surface-parity 2026-09-30）：
进程内组装 daemon domain、引用解析纪律、key 明文不回显与隔离测试要求。

## Requirements

### Requirement: CLI skills 族与 RPC 同源

`skill-creator skills` 子命令族 MUST 进程内组装 daemon domain 并消费与 RPC
router 相同的 domain 服务（不复制业务规则）；workspace/provider/skill 引用
MUST 按 `~`/路径反查/ws_* id 精确/label 前缀（大小写不敏感）解析，歧义或零
匹配 MUST 列出候选并以用法错误退出（exit 2）。

#### Scenario: label 前缀唯一命中

- **WHEN** `skill-creator skills list <labelPrefix>` 且该前缀仅匹配一个已注册 workspace
- **THEN** 命令以该 workspace 作用域执行并 exit 0

#### Scenario: 歧义引用拒绝

- **WHEN** 引用前缀匹配多个 workspace/provider/skill
- **THEN** stderr 列出全部候选并 exit 2，不执行任何作用域动作

#### Scenario: toggle 忠实投影 symlink 冲突

- **WHEN** `skills toggle` 的目标经 domain 判定为 symlink 条目 conflict
- **THEN** 该条目打印 conflict 行，命令 exit 1，不重命名链接目标内文件

### Requirement: CLI update 族显式作用域

`skills update check/apply` MUST 要求显式 workspace + provider 作用域（不做
隐式全 workspace 扫描）；apply MUST 只重装 check 已确认过时的技能并逐项打印
installed/failed/skipped，部分失败 MUST 保留已完成项。

#### Scenario: apply 拒绝未确认项

- **WHEN** `update apply` 指定 check 未标记为 updated 的技能名
- **THEN** 该项被 domain 拒绝并投影为失败/跳过，不伪装成功

### Requirement: CLI model 族同源配置

`skill-creator model` 子命令族 MUST 与 WebUI 消费同一份 dshSettings/modelCatalog
真相（`SKILL_CREATOR_HOME` 派生的同一持久化文件）；`routes` 输出 MUST NOT 回显
API key 明文（只报 configured 状态）；`route add` MUST 以 modelRoutes 整表替换
表达且拒绝重复 provider；`route remove` MUST 拒绝移除活动模型所在的路由。

#### Scenario: key set 后 routes 只报状态

- **WHEN** `model key set <provider> <key>` 成功后执行 `model routes`
- **THEN** 输出含 configured: yes 且不含 key 明文

#### Scenario: remove 活动路由被拒

- **WHEN** 活动 model 的 provider 执行 `model route remove <provider>`
- **THEN** 命令拒绝并提示先 `model use` 切换，exit 2

#### Scenario: use 自动补目录路由

- **WHEN** `model use <provider> <model>` 且 provider 无自定义路由但存在于目录
- **THEN** 先按目录条目创建路由（api/baseURL/models 推导）再切换活动模型

### Requirement: setup 模型参数段

`skill-creator setup` MUST 支持 `--model <provider>/<model>`（可配 `--effort`/
`--base-url`/`--api`/`--api-key`）模型配置段：无 `--model` 时出现其余模型 flag
MUST 用法错误；`--api-key none`（大小写不敏感）MUST 跳过凭据写入；模型段失败
MUST exit 1 且不回滚已完成的 symlink 与 agents-md 结果。

#### Scenario: 半配置拒绝

- **WHEN** `setup --effort high`（无 `--model`）
- **THEN** 用法错误 exit 2，不执行任何配置动作

#### Scenario: 模型段失败保留 link 结果

- **WHEN** `setup --model p/m --base-url <url>` 且 use 被 domain 类型化拒绝
- **THEN** 命令 exit 1，但全局技能 symlink 与 agents-md 块保持已完成的终态

### Requirement: CLI 隔离与副作用纪律

CLI 集成测试 MUST 以 `SKILL_CREATOR_HOME`（及涉及全局根时
`SKILL_CREATOR_SELF_SKILL_ROOT`）沙箱 spawn 真进程，MUST NOT 触碰操作者真实
home 数据；CLI 短命进程 MUST NOT 留下孤儿常驻进程。

#### Scenario: 沙箱 spawn 不触真实 home

- **WHEN** skills/model/setup 集成测试运行
- **THEN** 所有持久化写入落在沙箱 home，真实 `~/.skill-creator` 与 `~/.agents` 不变
