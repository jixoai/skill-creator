# Skill Creator 工具参考

事实源：CLI 帮助（`skill-creator help`）与产品 capability 登记表。工具名规则：
capability 名点号→下划线（`skills.search` → `skills_search`）。

## 概念模型

```text
Workspace（作用域第一层）
  |-- "~"      Global Workspace：聚合所有 Agent 的全局 skills roots（只读消费）
  `-- ws_*     Imported Workspace：已导入的本机目录（可写：创建/编辑/安装）
Provider = 一个 Workspace 内的 Agent skills root（providerId ∈ 社区 catalog：
  claude-code / codex / cursor / zcode / gemini-cli / warp / zed …）
技能身份 = { workspaceId, providerId, skillId(sk_*) } 三元组（服务端 opaque 签发）
```

- Global（`~`）可发现/查看/校验/启停既有技能，但创建与安装目标只能是 Imported
  Workspace——装技能前先用 `workspace_list` 确认可写目标，没有就引导用户在 GUI
  导入目录。
- 同一技能可能出现在多个 provider root（内容重复）；`skills_duplicates` 给出
  contentHash 分组，去重决策留给用户。

## MCP 通路（结构化消费推荐）

注册 stdio server（readonly 面，不需要 daemon 常驻）：

```json
{
  "mcpServers": {
    "skill-creator": { "command": "skill-creator", "args": ["mcp"] }
  }
}
```

（各宿主的 MCP 配置位置不同：Claude Code `claude mcp add skill-creator -- skill-creator mcp`；
ZCode/Codex/其它宿主写各自 mcp 配置，命令同为 `skill-creator mcp`。）

### 只读工具目录（stdio / daemon 内同构）

| 工具                        | 输入（JSON）                                    | 用途                                                                                                                                    |
| --------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_list`            | {}                                              | 列 Workspace（含 provider roots 与计数）                                                                                                |
| `skills_list`               | {workspaceId, providerId, includeDisabled?}     | 列一个 provider 的技能                                                                                                                  |
| `skills_info`               | {workspaceId, providerId, skillId}              | 读技能全文 + 元数据                                                                                                                     |
| `skills_validate`           | {workspaceId, providerId, skillId}              | 校验技能结构/frontmatter                                                                                                                |
| `skills_search`             | {query, limit? (1-50, 默认 10)}                 | 跨全部 Workspace 的 BM25 检索                                                                                                           |
| `skills_duplicates`         | {}                                              | 内容重复技能分组                                                                                                                        |
| `skills_search_config_open` | {}                                              | 用系统编辑器打开检索排除配置                                                                                                            |
| `skills_update_check`       | {workspaceId, providerId, skillIds?}            | 对照上游 lock hash 的过期检查                                                                                                           |
| `creator_load`              | {workspaceId, providerId, skillId}              | 可编辑文档基线（含 revision）                                                                                                           |
| `creator_revisions`         | {workspaceId, providerId, skillId, limit? ≤100} | 修订历史（含 diff）                                                                                                                     |
| `repository_scan`           | {source, ref?}                                  | 浅克隆+钉 commit+扫描 Git 技能源                                                                                                        |
| `repository_sources_list`   | {}                                              | 列 curated/user 发现源（https Git）                                                                                                     |
| `wiki_scopes`               | {}                                              | 列 wiki 作用域（global + 各 workspace）                                                                                                 |
| `wiki_list`                 | {scope}                                         | 列一个作用域的 pattern 碎片                                                                                                             |
| `wiki_read`                 | {scope, name}                                   | 读一篇 pattern 全文                                                                                                                     |
| `wiki_distill_start`        | {source, limit? ≤100}                           | 蒸馏 run（需产品 agent 内核；独立 stdio 形态下 start 正常返回 runId，run 立即 failed(kernel-unavailable)，经 wiki_distill_status 可见） |
| `wiki_distill_status`       | {runId}                                         | 蒸馏 run 状态/提案台账                                                                                                                  |
| `wiki_distill_cancel`       | {runId}                                         | 取消蒸馏 run                                                                                                                            |

变更类能力（安装/更新执行/启停/编辑/删除/写 wiki）在 MCP 面只有 `*_propose`
提案变体且仅存在于产品 GUI 的内置会话——外部 Agent 一律引导用户在 GUI 完成。

MCP resource 面：`skill-creator://skill/{workspaceId}/{providerId}/{skillId}`
（技能文档只读资源）。

## CLI 全参考

```text
skill-creator start          Boot the daemon and open the tray window
skill-creator open           Show/focus the tray window of a running daemon
skill-creator openinbrowser  Open the running WebUI in the system browser
skill-creator status         Check the running daemon
skill-creator stop           Gracefully stop the daemon
skill-creator search         Search local skills (BM25 + skill tokenizer)
skill-creator wiki           Persistent agent-experience wiki
                             (list/show/add/find/edit/remove/log/impact/scopes/distill)
skill-creator mcp            Run the skill-creator MCP server over stdio (readonly face)
skill-creator setup          Install/repair the global self skill link (--backup when overwriting yours)
skill-creator self-skill     Inspect the global self skill link (status | keep)
skill-creator version        Print the version
skill-creator help           Show this help
```

### search 细节

```bash
skill-creator search <query...> [--json] [--limit N]   # limit 1-50，默认 10
```

- 进程内完成（不要求 daemon 在运行）；空 query 或 flag 解析失败 exit 1。
- `--json` 输出 `{ "results": [...] }`（每项主要字段：name/description/
  canonicalPath/score/installations/duplicates，另有 id/contentHash 等）；人读模式
  含路径与重复项。
- 中英混合 query 均可（tokenizer 含中文 bigram 与 Latin 标识符切分）。

### wiki 细节

`skill-creator wiki <子命令>` 进程内执行（`distill` 例外，走 daemon RPC）：
list/show/add/find/edit/remove/log/impact/scopes/distill。`--workspace` 支持
registry label/ws_id 或路径直传。wiki 目录 = `<workspace>/.agents/skill-wiki/`。

## 技能更新模型

skills-CLI（`npx skills`）安装的技能带 lock hash：`skills_update_check` 只读对比
上游；过期技能的执行重装（apply）在 GUI 完成（Repository 安装管线 + 校验链）。
手工放入的技能（投影为 installedVia: "unknown"、updatable: false）不参与 lock 对比。

## 安全与边界

- MCP/HTTP 面只监听 loopback；daemon WebUI token 不出本机。
- 不要绕过工具面直接读写技能文件来做"管理"——启停状态、revision 校验、安装验证
  都有服务端不变量，绕过会破坏它们。
