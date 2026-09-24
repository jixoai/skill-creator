# skill-wiki Specification (delta)

## ADDED Requirements

### Requirement: wiki 经 capability/MCP 面可用

wiki 四能力 MUST 进 capability 登记并投影到 MCP 两形态：`wiki.scopes`/
`wiki.list`/`wiki.read`（readonly）与 `wiki.append`（approved-mutation）。
输入 schema MUST 与 rpc-contract 同源（无第二份手写镜像）。MCP 面上
`wiki.append` MUST 仅以 `wiki_append_propose` 出现（产 proposal 待人工审批，
stdio 形态不注册任何 mutation）；readonly 三面两形态都可用。

#### Scenario: agent 只读浏览

- **WHEN** agent 经 MCP 调 `wiki_scopes` → `wiki_list` → `wiki_read`
- **THEN** 依次获得 scope 索引、patterns 投影与单页全文（与 GUI/CLI 同一
  daemon 数据面）

#### Scenario: agent 写入走审批

- **WHEN** agent 经 MCP 调 `wiki_append_propose`（scope/title/body）
- **THEN** 产生 pending proposal（不写盘）；人审批后以 human-ui 主体执行，
  hash 幂等语义与 GUI append 一致
