# Tasks: dsh-alpha-native-subagents

## 1 升级（已完成）

- [x] 1.1 21 个 @deepseek-ai 依赖 0.1.5-rc.2 → 0.1.6-alpha.1 + lockfile 再生
- [x] 1.2 boot() bareModuleBaseUrl 死参摘除（alpha 生效破坏点，实测修复）
- [x] 1.3 契约常量：锁定包 ×10 + DSH_AUDITED_COMMIT → 0a15e36e（tag 检出审计）
- [x] 1.4 全量电池绿（838 + smoke 2/2；dist 重建后）

## 2 Roles 契约与目录

- [ ] 2.1 `src/shared/contracts/agent-roles.ts`：角色目录常量（slug/名称/版本化
      prompt section 引用/toolFilter allow 列表/描述）+ Zod schema
- [ ] 2.2 product-prompt.ts：角色 prompt sections（版本化，同既有模式 section 法）
- [ ] 2.3 kernel cordis.yml 写入：per-role tool-subagent 行（provider spawn/
      continuable/唯一 toolName/maxDepth 1）

## 3 会话面与安全

- [ ] 3.1 productToolDenyList per-mode allowlist 增补角色工具名（专注模式各自
      裁决；free 模式全放）
- [ ] 3.2 agent.sessions.list 过滤 origin==='subagent' 子会话
- [ ] 3.3 firehose：子会话事件 → 父轨 subagent 帧投影（descriptor/catalog/
      settled）；子转录探视经 session-transcripts
- [ ] 3.4 内核 dispose 前 drainContinuableDescendants 有界回收
- [ ] 3.5 角色 toolFilter 一律 deny ask_user_question（悬空红线）

## 4 面板 UI + 走查

- [ ] 4.1 Agent 面板：subagent 转录帧渲染（spawn 进度/工具行/结果摘要/取消）
- [ ] 4.2 会话头 lineage 计数（children/descendants）+ 子会话探视入口
- [ ] 4.3 vision 子代理走查（本阶段独立走查）
- [ ] 4.4 聚焦测试：kernel 断言角色行激活；sessions 断言 allowlist/过滤/帧投影/
      drain；负面（未列角色 deny、toolFilter 外结构化拒绝）

## 5 收尾

- [ ] 5.1 全量电池 + typecheck + webui check + build + dist 冒烟
- [ ] 5.2 AGENTS.md 诊断更新（DSH integration fact → 0.1.6-alpha.1 + 0a15e36e）
- [ ] 5.3 spec 同步归档
