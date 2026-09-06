# Skills 生态与管理器机会

审计日期：2026-09-06。以下优先引用一手站点或仓库；“卖点”是这些项目公开的产品表述，不等于 Skill Creator 应照搬的功能。

| 项目                                                                                  | 公开定位 / 卖点                                                          | 暴露的用户痛点                                                             | Skill Creator 应吸收的方向                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [OpenAI Codex Skills](https://developers.openai.com/codex/skills/)                    | Codex 可发现并按需加载 `SKILL.md`，通过目录约定复用工作流                | 技能分散、用户不知道何时会被加载、说明与资源缺少统一生命周期               | discovery、启停、来源与加载命中记录；把“被加载”与“有效”分开观测        |
| [Anthropic Claude Code Skills](https://docs.anthropic.com/en/docs/claude-code/skills) | 用 `SKILL.md` + supporting files 扩展 Claude Code，支持项目级/用户级技能 | 技能依赖目录约定，重复、过时、冲突和上下文成本需要人肉维护                 | frontmatter/触发器/引用分析，stale、overlap、context-cost 指标         |
| [Vercel skills.sh](https://skills.sh/)                                                | 面向多 Agent 的公开 skills directory，强调搜索、安装和按 Agent 显示      | “在哪里找”和“怎样装到当前 Agent”比写一个 skill 更难；不同 Agent 路径不一致 | provider adapter、安装目标选择、来源 pinned commit、跨 Agent root 映射 |
| [ClawHub](https://clawhub.ai/)                                                        | Agent skill registry，公开描述强调快速 registry 与 vector search         | 关键词搜索难发现语义相近技能；热门不等于适合当前 workspace                 | 关系图与语义检索只做辅助，必须显示 evidence、版本和适用 scope          |
| [Anthropic Skills 仓库](https://github.com/anthropics/skills)                         | 官方示例与可复用 skills，包含文档、表格、PDF 等任务资产                  | skill 往往不是单文件，而是脚本、模板和资源的组合；升级可能破坏调用方       | 资源清单、验证、变更预览、回滚；扫描脚本但不允许 Agent 任意写盘        |
| [OpenAI Skills 仓库](https://github.com/openai/skills)                                | 官方 Codex 技能集合与领域工作流示例                                      | 用户需要知道技能来源、适用模型和与本地技能的优先级                         | provenance、provider/skill identity、启用优先级和冲突解释              |
| [obra/superpowers](https://github.com/obra/superpowers)                               | 社区工作流 skills，强调把开发流程固化为可复用方法                        | 技能内容会膨胀成“大而全”的提示词，维护者难拆分、合并和验证                 | Agent 提供 optimize/split/merge proposal，先生成 patch 再审批          |

## 产品判断

普通用户和开发者最痛的不是“缺一个技能商店”，而是技能装多以后无法回答四个问题：

```text
这个 skill 现在是否有效？
它和其它 skill 是否冲突？
它是否值得占用上下文？
Agent 的修改能否安全撤销？
```

因此优先级应是：

1. **Manager authority**：Workspace/Provider/Skill identity、启停、来源、revision、安装与恢复。任何 Agent 都不能绕过它写盘。
2. **Intelligence**：结构解析、质量、stale、overlap/conflict、引用完整性、上下文成本，并且每条结论带 evidence。
3. **Steward workflow**：check、optimize、organize 三种任务；Agent 只能调用专属 domain tools，输出 finding/proposal；validation、approval、apply、rollback 由 Manager 完成。
4. **Runtime integration**：DSH 作为本轮 Agent/session/model/tool/stream 基座；Codex 后端留待后续验证，不列入本轮交付；backend unavailable 时 Manager 仍可用。
5. **Sharing**：导出、分享、评分和社区发现最后做；没有 provenance、版本和验证结果时，分享只会扩大垃圾和冲突。

## 不应复制的模式

- 只做目录和安装命令：解决 discovery，不能解决 stale、冲突、质量和回滚。
- 只做向量搜索：能找相似技能，却不能证明冲突或安全可应用。
- 只做通用聊天：Agent 可以说“建议合并”，但没有 revision、patch、validation 和 approval 就不能成为产品行为。
- 只展示热门/下载量：流行度不能替代当前 Workspace 的适用性和证据。

## 对 Skill Creator 的可验证差异化

```text
生态工具：发现 -> 安装
Skill Creator：发现 -> 分析 -> 决策 -> 提案 -> 验证 -> 审批 -> 应用 -> 回滚 -> 记录
```

这个闭环才是“让 Agent 成为技能管家”的核心；分享能力应建立在已验证的 provenance、revision 和 audit 记录上。
