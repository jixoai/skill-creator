# Tasks: dsh-alpha-native-subagents

## 1 升级（已完成）

- [x] 1.1 21 个 @deepseek-ai 依赖 0.1.5-rc.2 → 0.1.6-alpha.1 + lockfile 再生
- [x] 1.2 boot() bareModuleBaseUrl 死参摘除（alpha 生效破坏点，实测修复）
- [x] 1.3 契约常量：锁定包 ×10 + DSH_AUDITED_COMMIT → 0a15e36e（tag 检出审计）
- [x] 1.4 全量电池绿（838 + smoke 2/2；dist 重建后）

## 2 Roles 契约与目录

- [x] 2.1 `src/shared/contracts/agent-roles.ts`：角色目录常量（slug/名称/能力面/
      版本）+ 模式暴露矩阵 AGENT_MODE_ROLES + 模型面命名法 role_*
- [x] 2.2 `src/daemon/kernel/agent-roles.ts`：三角色版本化 persona（v1）+
      agentRoleRowsYaml 行生成（spawn/continuable/唯一 toolName/maxDepth 1/
      deny ask_user_question/allow = 精确 MCP 注册名）
- [x] 2.3 kernel cordis.yml 写入：MCP 桥在场时追加角色行（无桥不写——allow
      实名校验会响且角色无 MCP 面无意义）

## 3 会话面与安全

- [x] 3.1 productToolDenyList per-mode allowlist 增补角色工具名（create/manage:
      reviewer+writer；explore: researcher+reviewer；free 全放；裸 delegation
      工具仍拒）——dsh-kernel 实 boot 断言钉死
- [x] 3.2 agent.sessions.list 过滤 origin==='subagent' 子会话
- [x] 3.3 firehose：父会话 subagent/catalog 事件 → 新帧类别 subagent（schema
      门 + 脱敏投影）；settlement 经官方 subagent-settled 用户消息回流 user-text
- [x] 3.4 内核 dispose 前 drainContinuableDescendants 有界回收（失败不阻塞父回收）
- [x] 3.5 角色 toolFilter 一律 deny ask_user_question（悬空红线；单测钉死）

## 4 面板 UI + 走查

- [x] 4.1 Agent 面板：subagent 帧渲染为居中 hairline 行（bot 图标 + agent chip +
      label + mode chip；TranscriptView + store 投影 + payload schema 门）
- [~] 4.2 会话头 lineage 计数：首版以会话内 subagent 帧计数表达（官方 catalog
      计数 RPC 留待有真实 spawn 流量后接）；子会话转录探视延后
- [x] 4.3 vision 走查（独立完成）：PASS——spawn 行渲染干净、与既有居中行视觉
      语言一致；P2 发现（工具行 args 不可见）为种子数据伪影（真实流走
      tool-args-delta 通道），非本阶段回归；P3×3（composer 芯片截断/状态点/
      药丸大小写）为既有设计
- [x] 4.4 聚焦测试：test/agent-roles.test.ts 12 用例（目录一致性/YAML 不变量/
      模式矩阵/schema 门）+ dsh-kernel 实 boot 角色行断言

## 5 收尾

- [x] 5.1 全量电池 880 + typecheck + webui check（30 文件/284）+ build + dist
      冒烟（CI 双 job 绿：web-mode-smoke + full-battery）
- [x] 5.2 AGENTS.md 诊断更新（DSH integration fact → 0.1.6-alpha.1 + 0a15e36e
      + bareModuleBaseUrl 升级注记；Agent Role/Composer 词汇；拓扑模块表）
- [x] 5.3 spec 同步归档（agent-kernel 主 spec 并入子代理三 Requirement +
      版本矩阵 MODIFIED；4.2 lineage 计数以帧计数首版表达、catalog RPC 延后
      记录于 design）
