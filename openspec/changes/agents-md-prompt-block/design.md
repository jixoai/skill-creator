# Design: agents-md prompt block

## D1 块协议（marker 对 + 整块替换）

```text
<skill-creator-v2>
…产品所有的引导文本（setup 时以当前代码内容整块刷新）…
</skill-creator-v2>
```

- 定位用**首个**成对的 `<skill-creator-v2>` / `</skill-creator-v2>`（indexOf，
  不用正则跨行语义）；存在多个完整块 → 只更新首个、结果报 `multiple` 提示人工
  清理（不做批量改写）。
- 只有开标签无闭标签（残缺）→ typed failed（`unterminated-block`），不追加——
  防止产生嵌套双块；人工修复后重跑即可。
- 「内容同」判定 = 标签间文本与当前产品文本逐字节相等（trim 尾部换行差）。

## D2 时机与输出

```text
runSetup()
  link 结果 …
  agentsMd = ensureAgentsMdPromptBlock()
     injected → log "agents-md guidance block injected at <file>"
     updated  → log "agents-md guidance block refreshed"
     current  → 静默
     failed   → log reason（setup 继续，exit code 不受影响——引导块是增强项）
self-skill status
  + "agents-md guidance block: present|absent|broken"
```

daemon 启动 ensure **不**触碰 AGENTS.md（proposal 已定级：侵入度不同）。

## D3 文本内容（$PROMPT）

常驻指令面要短（每会话都付 token 成本）：三条行为规则 + 一个指针，不复制工具
目录（那属于技能文档）：

```md
<skill-creator-v2>
## Skill 管理与沉淀走 skill-creator

- 发现/校验/启停/安装/更新/清理重复技能与跨 Workspace 检索，优先用 skill-creator
  （CLI：`skill-creator search`、`skill-creator skills …`、`skill-creator wiki …`；
  结构化消费注册 stdio MCP：`skill-creator mcp`，只读）。不绕过工具面直接改
  技能文件。
- 完整 CLI/MCP 用法与概念模型：读全局技能 `skill-creator-v2`
  （~/.agents/skills/skill-creator-v2 的 SKILL.md 与 references/tools.md）。
- 技能使用中形成的经验、踩坑与最佳实践，用 skill wiki 记录与迭代
  （`skill-creator wiki add/list/show`；先查重再新增，迭代优于堆积）。
</skill-creator-v2>
```

文本常量与技能文档同源演进（能力变更时两者一起改；无独立版本号——整块刷新
即版本）。

## D4 隔离与测试

- 文件路径 = `dirname(selfSkillRoot())/AGENTS.md`（valve 沙箱自洽）。
- 测试：注入到不存在文件 / 追加到无块文件 / 同内容 current / 内容漂移 updated /
  块外内容与块前后文本逐字保留 / 残缺开标签 failed / 多完整块 multiple /
  只读文件 failed（不抛）。setup 集成断言输出行。
