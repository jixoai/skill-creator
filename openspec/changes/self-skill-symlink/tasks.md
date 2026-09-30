# Tasks

- [ ] 1.1 `skills/skill-creator-v2/{SKILL.md, references/tools.md}` 入仓（内容自 v1
      常量迁移 + 所有权注释改 symlink 语义）；package.json `files` += "skills"；
      pack 产物含技能目录
- [ ] 1.2 `src/daemon/self-skill.ts` 重写：resolveSelfSkillSource（import.meta 自定位
      + anchor 注入）/ provenanceOf / ensure 七态（linked/relinked/current/migrated/
      kept/failed + 冲突 foreign-link|user-directory）/ resolveConflict({backup}) /
      keepUserVersion()（appDir 指纹记录）
- [ ] 1.3 `main.ts` 适配新 ensure 结果日志；`product-prompt.ts` 措辞 installs→links
- [ ] 2.1 ccski symlink 发现增补模块（D4）+ 接线 skill-service / workspace-registry
      默认扫描器；既有 seam 与测试不回归
- [ ] 3.1 CLI `self-skill` 子命令（status/install [--backup]/keep，退出码 typed）
- [ ] 3.2 CLI `start` 冲突提醒：TTY 三选交互 / 非 TTY 提示打印
- [ ] 4.1 契约 `contracts/self-skill.ts` + rpc-contract selfSkill.{state,resolve,keep}
      + daemon 路由接线
- [ ] 4.2 WebUI：self-skill store + Workspaces 首页冲突 banner（覆盖[备份勾选]/保留）
      + toast 终态
- [ ] 5.1 测试：self-skill 七态 + legacy 迁移 + 备份格式 + keep 指纹 + 增补模块形状
      + 闭环检索召回（经 symlink）
- [ ] 5.2 WebUI 走查：沙箱冲突 banner 桌面 + 窄屏交互证据（dev + 隔离阀）
- [ ] 6.1 全量门禁（test/typecheck/webui check/fmt/build/pack）+ 子代理复核 + 处置
- [ ] 6.2 AGENTS.md / i18n.zh.md 同步 + 归档 + 分段提交
