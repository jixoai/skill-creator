# Proposal: redesign-model-tabs-and-agent-panel

## Why

用户原始需求 [2026-09-13]：

1. 「模型的配置体验还是非常糟糕……把这个配置体验改成 tabs，每个 tab 一个配置，
   不乱窜。Custom 和 Provider 合并成一种 NewTab 的体验——Provider 和 Custom 本是
   同源，Provider 的作用就是提供默认预设。Custom 可以做到 Provider 能做到的所有
   事情，Provider 本身也是基于 Custom 来实现的。甚至开发者可以自定义 Provider
   （自定义图标等）。」
2. 「Agent 对话使用体验几乎就是 0 升级……先放弃现有的这些界面，只留下必要的
   组件，然后重新设计。和 dsh-webui 的完成度相比差距非常多。有源代码，抄作业
   都抄不明白。」
3. 「包括你写的差距五项，这些也纳入迭代目标……使用 openspec 推进：fast-remix
   推进 plan+coding → 子代理完成 + vision 走查 → codex 打分 → 不达标回到
   plan+coding。」

## What Changes

- **Model 配置 tabs 化**：Model 设置分区重构为「路由 tabs + New tab」——每个已建
  路由一个 tab（内联其 key 状态与活动模型切换），`+ New` 打开统一建路由体验：
  预设目录（provider 卡，预填 icon/协议/模型）与空白 Custom 是同一表单的两种起
  始态；图标可换（内置目录图 + 上传自定义 svg）；活动模型选择并入 tabs 语境，
  不再与画廊混排。
- **Agent 面板重设计**：对照 dsh-webui conversation 完成度重排信息架构（消息/
  工具行/思考/composer/附件的解剖学对齐官方），保留必要组件（markstream 气泡、
  审批卡、Tasks 卡、上下文条），其余布局推倒。
- **差距五项收尾**：工具参数流式展示、assistant 附件回显、edit-resend 语义明示
  等按本轮设计统一纳入。

## 流程（用户指定）

openspec 驱动 + fast-remix（super-thinker plan → 子代理 coding → PM/vision 走查
→ codex 打分循环至达标）。

## Non-Goals

- 不改 daemon 模型路由/凭据桥的存储与热加载机制（上一轮已验证正确）。
- 不做 dsh-webui 的多会话 sidebar（面板内会话下拉保留）。
