# Tasks

- [x] 1.1 `src/daemon/self-skill.ts`：文档常量（SKILL.md + references/tools.md 文本，
      `SELF_SKILL_VERSION` 与 frontmatter 所有权标记）+ `ensureSelfSkill()`
      （D2 状态机：installed/updated/current/disabled/foreign/failed
      `{kind:"failed"}`；env `SKILL_CREATOR_SELF_SKILL_ROOT` 与显式 root 双通道）
- [x] 1.2 `src/daemon/main.ts` 生产入口挂 `ensureSelfSkill`（失败只记日志，不阻塞
      boot；意图头登记第 4 意图）；dev.ts 不挂（design D1）
- [x] 2.1 `product-prompt.ts` v2：移除内嵌能力面枚举，改为 skills_search →
      skills_info 读取全局 `skill-creator-v2` 的指针（PROMPT_VERSION bump "2"）；
      会话特有约定（无 shell/proposal/卡片/ask_user_question）保留
- [x] 3.1 `test/self-skill.test.ts`：六态语义（含 disabled 禁用痕迹不重装）+
      IO 失败不抛 + 文档不变量（frontmatter 过 Creator/ccski 校验、name=目录名、
      标记字段在场）
- [x] 3.2 `test/product-prompt.test.ts` 适配 v2（指针断言在场，旧枚举断言替换）
- [x] 4.1 聚焦测试 + `pnpm check` 分解门禁（test 1541/1541、typecheck、webui
      check、任务文件 fmt ✓）+ `openspec validate self-skill-bootstrap --strict`
- [x] 4.2 真实走查（双层）：隔离 root + 隔离 HOME 下 dist daemon 启动自举落盘 →
      `skill-creator search --json` 召回 `skill-creator-v2`（CLI 级闭环）+
      单测内 search seam 闭环
- [x] 5.1 子代理复核（zcode-subagents 替代 codex，compact 任务档）：8/10；P1-1
      （禁用后静默重装→toggle conflict 永久态）已修（disabled 态 + 测试）；
      P2-1（installedVia: manual 不可观测→改 "unknown"）、P2-2（stdio 蒸馏语义
      改 run failed(kernel-unavailable)）、P2-3（main.ts 意图头）、P2-4（本勾选）、
      P2-5（--json 字段标注主要字段）已修；proposal 夸大措辞已修
- [x] 5.2 同步 AGENTS.md（产品真相/安全边界一行）+ i18n.zh.md 词汇；归档 change；
      commit
