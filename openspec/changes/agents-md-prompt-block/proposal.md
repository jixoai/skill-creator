# Proposal: agents-md prompt block — setup 向 ~/.agents/AGENTS.md 注入/更新引导片段

## Why

用户原始需求 [2026-09-30]：「setup 还有几个工作：1. 就是往 ~/.agents/AGENTS.md 中
注入或者更新 `<skill-creator-v2>$PROMPT</skill-creator-v2>` 片段，这个片段的作用是
引导 Agent 使用 skill-creator 去管理和维护和使用 skills，特别是使用 wiki 的部分
实现记录和迭代。」

`skill-creator-v2` 技能依赖宿主的技能触发机制（条件加载）；而 `~/.agents/AGENTS.md`
是本机所有读该约定的 Agent 的**必载**指令面。一段短的、带标记的引导块能把
「技能管理/检索/沉淀走 skill-creator」变成常驻上下文，块内只放指针与硬规则，
细节仍由技能文档承载（单一事实源不搬家）。

## What Changes

```text
skill-creator setup
  |-- （既有）ensure 全局技能 symlink + 冲突裁决
  `-- （新增）ensure ~/.agents/AGENTS.md 的 <skill-creator-v2> 管理块
        |-- 文件不存在 ------> 创建仅含该块的文件 → injected
        |-- 块存在且内容同 --> current（不动）
        |-- 块存在且内容异 --> 仅替换 <skill-creator-v2>…</skill-creator-v2>
        |                     标签之间的内容 → updated
        `-- 无块 -----------> 文件末尾追加（前置空行分隔）→ injected
  块外内容永不触碰；IO 故障 → typed failed，不炸 setup 其余步骤。
```

- **块内容**（$PROMPT，产品代码所有）：引导三条——①技能管理/检索/启停/升级/清理
  走 skill-creator（CLI `search`/`skills`/`wiki` 与 stdio MCP `skill-creator mcp`），
  不绕过工具面直接改文件；②完整工具目录读全局技能 `skill-creator-v2`；③经验/
  认知用 skill wiki 记录与迭代（先查重再新增）。
- **注入时机**：仅显式 `setup`（daemon 启动 ensure 不碰用户的 AGENTS.md——链接
  技能目录与改写全局指令文件的侵入度不同级）。
- **可观测**：`skill-creator self-skill status` 增报块状态（present/absent）。
- 隔离阀沿用 `SKILL_CREATOR_SELF_SKILL_ROOT`（AGENTS.md = 根的父目录下推导，
  沙箱自洽）。

## Impact

- **新增能力**（setup 行为扩展 + status 投影）；不改任何既有契约/持久态形状。
- 安全边界：对用户全局指令文件的写入**仅限标签对之间的内容**；无标签对的文件
  只做末尾追加；任何解析不确定都按「无块」处理（追加前若文件尾部已有疑似残缺
  开标签则拒绝并提示人工处理——防双块）。
- 受影响文件：`src/daemon/self-skill.ts`（或伴随小模块）、`src/cli/cli.ts`
  （setup 输出/status 行）、测试、AGENTS.md/i18n 词汇。
