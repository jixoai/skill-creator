# Tasks

- [x] 1.1 packages/skill-wiki 子包骨架（package.json/tsconfig/入口）+ workspace 成员接线
- [x] 1.2 WikiWorkspace：双级 scope 解析 + 目录契约（index/logs/skill-impact/patterns）+ Zod 收窄 + origin/promotedFrom 预留
- [x] 1.3 patch 引擎（append/replace/insert_after + typed WIKI_PATCH_FAILED 错误码（SkillWikiError）+ 原子应用）
- [x] 1.4 contentHash 去重 append + index 同步
- [x] 1.5 分层采样 + gate 决策记录接口
- [x] 1.6 包级单测（目录契约/patch 锚定/去重幂等/采样上限/畸形投影）
- [x] 2.1 shared 契约 contracts/wiki.ts + rpc-contract wiki 组
- [x] 2.2 daemon wiki-service（scope 解析 + 委派 skill-wiki）+ domain 装配 + RPC 测试
- [x] 3.1 WebUI wiki store + WorkspacesHome 入口 + wiki 视图（列表/过滤/追加表单/空态）
- [x] 3.2 WebUI 组件测试（追加闭环/幂等提交/空态）
- [x] 4.1 门禁（typecheck/webui check/fmt/全量 test）+ dev 走查
- [x] 4.2 codex 复核 + 处置
