# Tasks: creator-agent-chat

- [x] 1.1 CreatorHome 重写：会话列表（target=ws 过滤 + creator 前端标记，
      非平行 meta schema）+ 新会话引导卡
- [x] 1.2 创作引导护栏：seed 结构化 prompt + 阶段 chip + 测试话术建议 + 草稿
      diff 卡 + Save via proposal
- [x] 1.3 会话面复用接入（skills-agent-page 共享组件 + creatorPreset；契约
      无 context.skillId 字段）
- [x] 1.4 「Chat about this skill」入口（skills 详情发起；resume 查找键 =
      target + seedSkill 精确匹配，无匹配即新建（r3））
- [x] 1.5 编辑器二级化（edit `/w/:wsId/creator/edit/:providerId/:skillId` /
      new `/w/:wsId/creator/new/:providerId`，search 携 subview/template）+
      模板退位为 seed 选项
- [x] 1.6 skill-detail 只读投影（去行内编辑/Save/Delete；skills 域零写 RPC
      （toggle 除外）源扫描断言；agent 域 Chat 入口不在此断言）
- [x] 1.7 composer 重组（底排分组 + 模型胶囊截断根治）
- [x] 1.8 Global 空态引导（切换 Imported）
- [x] 1.9 i18n（引用制，r2 修订）：完成时在 webui-i18n-bilingual 的
      inventory.md 标记对应 B 类面完成并双语适配（唯一帐本 = 该 change）
- [x] 1.10 验证门：全量绿 + webui check + ego-browser（引导流/草稿保存链/
      只读深链）+ vision 验收 + 进程回收
