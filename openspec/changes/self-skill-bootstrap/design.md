# Design: self-skill bootstrap

## D1 注入点：生产入口 main.ts，不进 bootDaemon

```text
main.ts (production)          dev.ts (dev)            bootDaemon (tests/进程内)
   |                             |                        |
   v                             v                        v
ensureSelfSkill() ✅            skip（dev 隔离）          skip（测试不触用户状态）
   |  try/catch + log，失败不炸启动
   v
bootDaemon(...)
```

理由：

- `bootDaemon` 是测试与进程内消费者的公共生命周期函数；挂进去会让
  daemon-lifecycle / daemon-domain 等测试向**真实** `~/.agents/skills` 落盘，违反
  「测试绝不污染 Owner 正在使用的数据」的既定纪律。改为生产入口 main.ts 显式调用，
  测试面零侵入；ensureSelfSkill 自身用单元测试 + env 隔离阀覆盖。
- dev.ts 的文件意图 [1] 明示「不读写正式用户状态」，开发 daemon 不自举。

## D2 所有权与更新语义（write-protect 用户内容）

```text
read ~/.agents/skills/skill-creator-v2/SKILL.md
   |
   +-- ENOENT
   |     +-- .SKILL.md 在场（产品禁用语义 = rename）-> 不写 → disabled
   |     `-- 目录空 -------------------------------> mkdir -p + atomic write SKILL.md
   |                                                + references → installed
   |
   +-- 解析 frontmatter（gray-matter，产物 unknown → Zod 收窄标记字段）
         |
         +-- x-managed-by == "skill-creator"
         |     +-- x-managed-version != CURRENT --> 重写 SKILL.md + references → updated
         |     `-- x-managed-version == CURRENT --> 不写（用户同版本改动视为用户内容）→ current
         |
         `-- 无标记 / frontmatter 不可解析 --------> 不写（用户自有内容）→ foreign
   |
   `-- IO 硬错误（EACCES/EIO/…）------------------> typed { kind: "failed" }，log，启动继续
```

disabled 分支（codex 复核 P1-1 处置）：产品的技能禁用实现是把 SKILL.md rename 为
同目录 `.SKILL.md`（skill-service 同约定）。若忽略该痕迹，用户禁用自举技能后下次
启动会静默重装——技能复活且与 `.SKILL.md` 并存进入 toggle conflict 永久态。禁用
痕迹在场时一律不写；用户在 GUI 重新启用（rename 回 SKILL.md）后恢复 current /
upgrade 判定。

- 标记字段进 frontmatter 而非正文：ccski `SkillFrontmatterSchema` 与 Creator
  `SkillFrontmatterSchema` 均 passthrough，未知键不破坏发现/校验；`x-` 前缀表达
  非标准扩展。name 与目录名一致（`skill-creator-v2`），满足最严格的宿主校验。
- 版本常量 `SELF_SKILL_VERSION` 独立于包版本：文档内容只随「对外行为面」（CLI/
  MCP 工具目录）变化，不随每个 patch 版本强制重写。
- 升级 = 整组重写（SKILL.md + references/tools.md）。同版本下 references 的用户
  增删不补偿（下个版本 bump 自然收敛），避免维护逐文件协商状态。

## D3 提示词指针化（v2）：不内联、运行时按需读

```text
v1: section 内枚举 mcp__skill-creator__* 用法（产品内嵌 agent 独享的知识）
v2: section 保留会话特有约定（无 shell / proposal 叙述 / 卡片 / ask_user_question）
    + 一条指针：用 skills_search{"query":"skill-creator"} 定位 → skills_info 读取
      name == "skill-creator-v2" 的技能 → 按其文档执行检索/管理/更新/wiki
```

选择指针而非 boot 时读文件内联：

- 「和普通流程一样」= 技能的常规消费方式是按需读取，不是全文注入 system prompt；
- 内联会在每次会话烧掉整份文档 token，且与外部 Agent 的消费方式不一致（回到双源）；
- 产品 agent 的内核工具面按 D1（dsh-kernel-rebase）禁用宿主 skills 自动发现行，
  「普通流程」在产品会话内的等价物就是 MCP `skills_search`/`skills_info`；
  指针给出精确的两步配方，消除「不知道 sk_ id」的冷启动摩擦。

## D4 文档内容契约（写给外部 Agent 的最小充分集）

- SKILL.md：触发条件丰富的 description（中英关键词都覆盖，供各宿主与
  skill-creator 自身的 BM25 召回）；正文只放「何时用什么」的决策树与硬规则
  （stdio readonly、mutation 需 GUI 审批、opaque id 不拼路径）。
- references/tools.md：完整 MCP readonly 工具目录（stdio 面 = 全部 readonly 能力，
  无 *_propose）、CLI 全参考、Workspace/Provider/作用域三元组概念、MCP stdio
  注册片段、更新模型（check readonly / apply 走 GUI 审批）。
- 事实源对齐：工具名从 `capability/domain-capabilities.ts` 投影规则推导
  （点→下划线），CLI 语法与 `src/cli/cli.ts` 帮助文本逐字核对，不在文档里发明
  不存在的工具或 flag。文档漂移由复核环节对照真实 `--help` 与 MCP describe 输出。

## D5 测试隔离阀

`SKILL_CREATOR_SELF_SKILL_ROOT` env 覆盖根目录（缺省 `~/.agents/skills`），命名
对齐既有 `SKILL_CREATOR_*` env 家族；ensureSelfSkill 亦接受显式 root 参数供单元
测试直接注入临时目录（env 与参数都给，测试不依赖全局 env 顺序）。
