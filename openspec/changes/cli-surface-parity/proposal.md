# Proposal: cli-surface-parity — CLI 暴露 WebUI 同源的技能管理与模型配置面

## Why

用户原始需求 [2026-09-30]：「> skill-creator 自身也需要暴露更多的 cli 能力，来实现
webui 的能力暴露出来使用，比如技能的维护、清理和升级 等等 2. setup 还需要支持
更加复杂的参数，来支持 model 的配置，就是 webui 中配置 provider，这些都需要通过
cli 提供同源的支持」。

目前 CLI 只有 `search`/`wiki`/`setup`/`self-skill` 四个进程内族 + daemon 生命周期
命令；WebUI 的技能启停、校验、重复清理、升级（skills.update）与模型 provider 配置
（agent.settings/modelCatalog）没有任何 CLI 入口。而 agents-md 引导块
（agents-md-prompt-block）已经把 `skill-creator skills …` 写进了对所有 Agent 的
常驻指令——这个命令族目前不存在，必须做实，否则引导块指向空面。

## What Changes

```text
skill-creator（进程内组装 createDaemonDomain，与 mcp stdio 同一先例；无 daemon 常驻依赖）
|
|-- skills <族>（同源 = 消费 rpc-contract 背后同一 domain 服务，不写第二份业务逻辑）
|   |-- list [<wsRef>] [--provider <pRef>] [--all] [--json]
|   |-- info <wsRef> <pRef> <skillRef> [--json]
|   |-- validate <wsRef> <pRef> <skillRef>
|   |-- toggle <wsRef> <pRef> <skillRef...> --enable|--disable
|   |-- duplicates [--json]
|   `-- update check <wsRef> <pRef> [--json]        （只读对比 lock hash）
|       `-- update apply <wsRef> <pRef> <name...> [--json]（重装过时技能）
|
|-- model <族>（同源 = dshSettings + modelCatalog；持久化与 WebUI 完全同一份文件）
|   |-- list [--json]        目录 provider + 已配置路由标注
|   |-- routes [--json]      当前路由表 + 活动模型选择 + 凭据状态
|   |-- use <provider> <model> [--effort <tier>]   切换活动模型（自动从目录补路由）
|   |-- route add <provider> --base-url <url> [--api <protocol>] [--model <id>]...
|   |-- route remove <provider>
|   |-- key set <provider> <apiKey> | key clear <provider>
|   `-- test [<provider> [<model>]]                连接探活（typed，失败也是值）
|
`-- setup [--backup] [--model <provider>/<model>] [--effort <tier>]
          [--base-url <url>] [--api <protocol>] [--api-key <key>]
      `-- --model 触发模型配置段：link + agents-md 之后执行；失败 exit 1（link 结果保留）
```

- **引用解析**（人类可读 → opaque，与 wiki CLI 同口径）：workspace ref = `~`/
  路径反查/ws_* id 精确/label 前缀（ci）；provider ref = id 精确或 label 前缀；
  skill ref = name（ci）→ directoryName → sk_ id。歧义/零匹配列出候选并 exit 2。
- **同源边界**：CLI 不重复实现任何业务规则——toggle 的 symlink guard、update 的
  skipped/unavailable 投影、settings 的 PRESET_REQUIRES_CREDENTIAL 拒绝码全部由
  domain 服务原样给出，CLI 只做参数解析与终端投影。
- **侵入度**：`setup --model` 是配置增强项，失败必须可见（exit 1），但不回滚已
  完成的 symlink/agents-md 结果。

## Impact

- **新增代码**：`src/cli/cli.ts` 两个命令族 handler + 引用解析助手（或独立模块，
  按 cli.ts 意图数上限裁决拆分）；`skills/skill-creator-v2/references/tools.md`
  CLI 表补全（引导块指向的单一事实源）。
- **不改**：rpc-contract、domain 服务、WebUI——CLI 是新增消费方。
- **specs**：新 capability `cli-manager-surface`（本 change 的 ADDED 增量）。
- **风险**：进程内组装 domain 会拉起 npx probe 预热与 search watcher——短命 CLI
  进程退出即回收，无孤儿进程面；集成测试一律 `SKILL_CREATOR_HOME` 沙箱 spawn。
