# Tasks

- [x] 1.1 `skills/skill-creator-v2/{SKILL.md, references/tools.md}` 入仓（内容自 v1
      常量迁移 + 所有权注释改 symlink 语义）；package.json `files` += "skills"；
      pack 产物含技能目录（npm pack --dry-run 实证）
- [x] 1.2 `src/daemon/self-skill.ts` 重写：resolveSelfSkillSource（import.meta 自定位
      + anchor 注入；dist 内同名构建 manifest 越过继续上溯——走查实锤修复）/
      provenanceOf / ensure 七态（linked/relinked/current/migrated/kept/failed +
      冲突 foreign-link|user-directory|foreign-entry）/ resolveConflict({backup}) /
      keepUserVersion()（appDir 指纹记录）
- [x] 1.3 `main.ts` 适配新 ensure 结果日志；`product-prompt.ts` 措辞 installs→links
- [x] 2.1 ccski symlink 发现增补模块（`ccski-symlink-entries.ts`，实测镜像 customDir
      形状）+ 接线 skill-service / workspace-registry 默认扫描器；全量测试无回归
- [x] 3.1 CLI `self-skill` 子命令（status/install [--backup]/keep，用法错误 exit 1）
- [x] 3.2 CLI `start` 冲突提醒：TTY 三选 readline 交互 / 非 TTY 提示打印
- [x] 4.1 契约 `contracts/self-skill.ts` + rpc-contract selfSkill.{state,resolve,keep}
      + daemon 路由接线（state 投影补 backupAvailable）
- [x] 4.2 WebUI：self-skill store（connected-effect 驱动——mount 时 rpc 未就绪的
      静默失败实锤后改挂 layout）+ Workspaces 首页冲突 banner + toast 终态
- [x] 5.1 测试：self-skill 24 项（七态 + dist-manifest 源解析 + legacy 字节级迁移与
      偏离冲突 + 无备份覆盖（EPERM 回归）+ foreign-entry 覆盖 + 备份格式 + keep 指纹
      漂移 + IO failed + 文档不变量 + symlink 闭环检索召回）+ ccski 增补 3 项 +
      CLI/RPC 4 项 + toggle symlink 守卫（skill-service）
- [x] 5.2 WebUI 走查（隔离实例 + 沙箱冲突根）：桌面 1440 banner 呈现 → 覆盖安装
      （备份 toast + 磁盘 link + skills-backup 时间戳目录含用户原版）→ 保留版本
      （toast + keep 记录 + 重载静默）→ 指纹漂移重提醒；窄屏 680 换行无溢出；
      vision 判读双 PASS（0 P1）
- [x] 6.1 全量门禁（test 全量绿 / typecheck / webui check / fmt / build / pack 含
      skills）+ 子代理复核 6.5/10 → P1×3 与 P2 加固全部处置（见下），HEAD 独立
      typecheck 复验（临时 worktree，剥离并行会话误卷入的 sourceRevision hunk）
- [x] 6.2 AGENTS.md / i18n.zh.md 同步 + 归档 + 分段提交

## 复核与走查处置记录

- 走查实锤修复 ①：ccski root 扫描跳过 symlink 条目（`entry.isDirectory()` 恒
  false）→ D4 增补模块；② layout connected-effect 之外的状态加载在 rpc 未就绪时
  静默丢失 → 挪入 connected-effect；③ 开发仓 dist/ 内同名构建 manifest 截胡源
  解析 → 缺 skills/ 的候选包根继续上溯（+单测钉死）。
- 测试脚本两次踩坑自纠：批量 python 补丁未落盘（改用 Edit 工具 + 写后读回）；
  `rg -rn` 的 -r 替换陷阱重犯（AGENTS.md 已有记录）。
