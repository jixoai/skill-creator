# creator-skill-store · 批 3 dev 沙箱全链走查证据

2026-10-09 · MainAgent 亲自走查（agent-browser eval 断言；CDP 截图本机不可靠不依赖）
环境：标准 `pnpm dev`，dev home `/tmp/sc-v2`（沙箱每轮清空重建；未触碰真实
~/.agents 与 ~/.skill-creator）；走查后生产 daemon 已恢复（PID 42184，tray mounted）。

## 链路三元组

| # | 操作 | 断言 | 结果 |
|---|---|---|---|
| W1 | Global（`~`）Creator 页 → New skill → 填 directoryName/name/description → Create | 跳转 `/w/~/creator/store/walkthrough-probe`；store 落盘 `<home>/.skill-creator/creator-skills/walkthrough-probe/SKILL.md` | ✓ |
| W2 | （创建即 auto-apply） | `<home>/.agents/skills/walkthrough-probe` 为真实目录（entity-local，非 symlink）；`.ccski-state.json` 实体+投影记录在场 | ✓ |
| W3 | Store 列面 `/w/~/creator/store` | 行渲染「Applied to 1 scope(s)」+ Global root 展开 + Uninstall/Apply to…/Sync/Delete origin 四动作 | ✓ |
| W4 | Apply to… 对话框 | 全部目标在 `/tmp/sc-v2` 下（隔离修复实证）；开放标准组（`.agents/skills`）默认勾选；勾 `.codex/skills` → Apply (2) → `.codex/skills/walkthrough-probe` = symlink → `.agents/skills` 实体 | ✓ |
| W5 | 外部直改 origin 文件（架构本义：origin 是普通目录）→ 列面刷新 → Sync | 「Outdated」角标出现 → Sync → 实体 SKILL.md 含新正文；symlink 投影仍解析；角标清除 | ✓ |
| W6 | Uninstall | 实体库清空、`.codex` 投影摘除、state 记录全清（GC）、store 目录原样；列面回「Not applied」；Sync 禁用语义面 | ✓ |
| W7 | Delete origin → 确认闸（Cancel/Delete origin） | store 目录删除；列面空态 | ✓ |
| — | console | body 全文无 error/failed 标记 | ✓ |

> 路径终版注记 [2026-10-09]：走查时 store 位于 `<home>/.skill-creator/creator-skills`
> （批 3 修正形态）；Owner 终版裁决改 `<homeDir>/.agents/creator-skills`（统一
> .agents 目录，考虑 Project 场景推广）——下文 W1 断言中的路径按历史记录保留。

## 走查抓到并当场修复的两只真 bug

1. **`updatedAt` 浮点 mtime 击穿输出契约**：`fs.statSync().mtimeMs` 未取整，
   `CreatorStoreSkillSchema.updatedAt: z.number().int()` 拒绝 → oRPC Output
   validation failed（列面整面挂）。修复：`Math.trunc` ×2（list/status 投影）。
2. **dev daemon 的 Global 投影面/应用面指向真实家目录**：应用选择面列出
   `/Users/kzf/.claude/skills` 等（dev 应沙箱在 dev home）。定性迭代（重要）：
   第一版修法（globalProviderRoot 默认改 homeDir()）被测试套否决——42 败实证
   「HOME（agent roots 用户家语义）与 SKILL_CREATOR_HOME（应用状态语义）双 home
   分离」是测试套故意钉住的设计，不得在 provider-roots 合并。正修：`src/daemon/
   dev.ts` dev 隔离补全——HOME/USERPROFILE 一并指向 dev home（os.homedir() 经
   env.HOME 跟随沙箱；子进程 npx/git 同享）；provider-roots 默认回退 os.homedir()
   并注释固化双 home 裁决。实机复核：应用面 roots 全在 /tmp/sc-v2、真实家目录
   零命中。生产路径零变化（dev.ts 仅 dev 入口）。

## store 路径基点修正（Owner 原文对齐）

批 1 实现为 `<homeDir()>/creator-skills`（生产 = `~/creator-skills` 裸目录）；
Owner 原文「~/.skill-creator/creator-skills」→ 修正为 `appDir()/creator-skills`
（design/proposal/spec/意图头/测试 8 处同步；测试 11/11 绿）。
