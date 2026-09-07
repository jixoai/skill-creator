# dsh-kernel-rebase 验证记录（阶段 6，2026-09-08）

## 6.1 端到端

- **authority 链（协议级 client 驱动）**：`test/e2e-authority-chain.test.ts` ——
  MCP `skills_toggle_propose` → pending（磁盘未动）→ approve → 磁盘真实变化
  （`SKILL.md` ↔ `.SKILL.md`）→ 再提议启用 → 审批恢复；审计链
  `created→approved→executed` ×2 精确有序。reject 路径磁盘不变 + 晚到审批幂等。
- **面板链（浏览器实测）**：dev daemon（内核 88 entries）+ IAB —— 面板开合
  （1100px 常驻 440px / 680px 全屏覆盖，无横向溢出）、Escape 关闭、会话创建
  （`agent-<uuid>` idle）、prompt 驱动 turn 帧、0 console errors。store 交互测试
  覆盖延迟/失败/断线代次门（`webui/src/lib/__tests__/agent-panel.test.ts`）。
- **steward 四 action 回归**：`skill-steward-runtime` / `agent-steward` /
  `skill-steward-contracts` 全绿（validate→approve→apply→rollback 链不变）。
- **未验证项（操作者验收）**：真实 LLM tool round（模型经 `mcp__skill-creator__*`
  自主调用工具 + ui 卡引导效果）需要 provider 凭据；本环境无凭据，提示词 section
  的引导效果以 4.3 单测 + 卡片/工具协议级对拍替代。

## 6.2 clean-install drill（内核形态）

```
[clean-install] PASS: install=0 kernel entries=88 agentPresetsRow=true health=true restart=true
```

仓库外空目录 `npm install <tarball>` → start（内核 mounted、无 dsh-client vendor、
agent-presets row 在场）→ health → stop → endpoint 释放 → restart → final stop。
过程中修复：`@deepseek-ai/dsh-agent-presets` 显式入 dependencies（heal 只镜像根
闭包，entry row 引用的包必须在册）。

## 6.3 全量门禁（逐条独立，2026-09-08）

| 门禁 | 结果 |
| --- | --- |
| `pnpm test` | 501 passed / 501 |
| `pnpm typecheck` | ✓ |
| `pnpm --dir webui check` | 0 errors / 0 warnings |
| `pnpm build` | ✓（dist 干净） |
| `pnpm exec vp fmt --check` | ✓ |
| `git diff --check` | ✓ |
| `npm pack --dry-run` | 91 files，无 web-composition 残留 |
| `openspec validate --all --strict` | 10 passed / 10 |

产物 grep：`dist/` 无 `dsh-web-app` / `dsh-host-webserver` / `dsh-client-*` /
`@skill-creator/dsh-client` 引用；staged package.json 依赖清单无 web-composition 包。
