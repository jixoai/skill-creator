# Skill Steward 发布清单（release checklist）

维护日期：2026-09-07（openspec steward-product-workflow task 4.4）。本文件是发布
验收的唯一入口：每个发布前必须在此逐项记录命令、结果与证据路径；命令输出以实际
执行为准，不以构建通过冒充安装可用。

## 1. 发布 smoke（必跑）

```bash
pnpm build                                  # 产出 dist/ + dist/webui（smoke 依赖 SPA build）
pnpm --dir webui build                      # 确保 webui/build 为最新（smoke 的恢复面）
pnpm exec tsx scripts/steward-smoke.sh.ts
```

- 退出码必须为 `0`；任何场景失败都会以 `steward-smoke: FAIL:` 输出根因并以 `1` 退出。
- 证据落盘：`openspec/changes/steward-product-workflow/artifacts/steward-smoke.json`，
  提交时随 change 归档。场景与断言：

| 场景                  | 断言要点                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| clean-directory start | 空隔离 home 启动 daemon：`/api/health` ok、DSH host mounted（entries 计数入证据）                                  |
| workspace mutation    | import + `creator.save` 真实落盘 `skills/smoke-skill/SKILL.md`（sha256 入证据）                                    |
| stale conflict        | optimize 提案后外部编辑 → `validate` = `stale`；`approve` 被类型化拒绝（拒绝文案入证据）                           |
| approval              | 重跑 → `validate` = `valid`（逐项 checks 计数）→ `approve` 铸 grant（grantId + fingerprint 前 16 位入证据）        |
| apply                 | `outcomeStatus: applied` + mutation 明细（relPath/semantic/revision）+ 落盘前后 sha256                             |
| rollback              | edit 类走 reverse proposal 独立审批后 apply；字节恢复到预 apply 快照（sha256 断言）                                |
| stop / restart        | stop 后 endpoint 拒连；同 home 重启 `/api/health` ok、workspace registry 持久化、技能重发现                        |
| DSH unavailable       | 第二 home（DSH_HOME=普通文件）：`status.dsh.mounted:false` + typed reason + SPA 恢复面 200 且不注入 `__DSH_BOOT__` |

注意事项（实测教训，勿回退）：

- sandbox 必须用 `/tmp` 短前缀（macOS IPC `sun_path` ~104 字符限制；系统 TMPDIR 长
  路径会 `listen EINVAL`）。
- 源码态运行必须显式传 `webuiDir`（默认解析到 `webui/static`，无 `index.html`，
  DSH 降级恢复面会 404）。
- smoke 脚本的 try 块必须带 catch 记录失败再退出；裸 `finally + process.exit(0)`
  会把未捕获异常吞成成功退出码。
- edit 与 split/merge 的 rollback 形态不同：前者是 reverse proposal（需独立人工
  批准后走正常 apply 链），后者是 rollback grant（`applyRollback` 反向重放 journal）。

## 2. 门禁（必绿）

```bash
pnpm test
pnpm typecheck
pnpm --dir webui check
pnpm build
pnpm exec vp fmt --check
git diff --check
openspec validate --all --strict
```

## 3. 生产包命令实测（发布前必复跑）

以构建产物 `dist/`（与 tarball 同运行内容）在隔离 HOME 实测 `version` / `help` /
`start`（headless 提示 exit 0）/ `status`（pid/port/tray 终态/token URL）/ `open`
（headless 提示）/ `openinbrowser`（打印 URL 并调系统浏览器）/ `stop`（endpoint
立即释放 + ENOENT 恢复提示）。流程见
`openspec/changes/steward-product-workflow/artifacts/verification.md` 4.3 节。

## 4. 已知发布阻塞（clean-install）

- **`ccski: link:../ccski`**：干净目录 `npm install <tarball>` 在解析该 spec 时
  静默 `exit 1`（npm 11.19 复现；node 24.20/26.1、`--legacy-peer-deps`、
  `--max-old-space-size=16384` 均不缓解；单独安装其它依赖正常）。本地 `../ccski`
  领先 npm 上的 2.4.0 两个提交（`customDirs`/`customProvider`——本仓 Provider 投影
  依赖，不能直接降级到 registry 版本）。处置（4.8 验收）：发布 ccski 新版本、或把
  必要代码依法打入产物（bundle），并完成仓库外空目录安装启动验证
  （`artifacts/clean-install.md`）。
- DSH runtime 锁定 `@deepseek-ai/* 0.1.2-rc.1`（commit `d347e703…`，MIT）；版本
  漂移经模块解析失败 fail-closed（typed reason + SPA 恢复），完整版本矩阵随 4.8
  clean-install 一并验证。

## 5. 发布证据清单

| 项                     | 路径                                                                     | 任务 |
| ---------------------- | ------------------------------------------------------------------------ | ---- |
| 发布 smoke JSON        | `openspec/changes/steward-product-workflow/artifacts/steward-smoke.json` | 4.4  |
| 三任务四 action 端到端 | 同目录 `acceptance.md`                                                   | 4.6  |
| 优化前后评估           | 同目录 `effectiveness.md`                                                | 4.7  |
| clean-install          | 同目录 `clean-install.md`                                                | 4.8  |

真实模型（live preset）至少完成一次「分析 → 方案 → 批准 → apply → rollback」的
证据归 4.6；凭证缺失时记录 blocker，不得把 unavailable 当作通过。
