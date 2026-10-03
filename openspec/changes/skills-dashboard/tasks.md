# Tasks: skills-dashboard

- [x] 1.1 `skills.listWorkspace` 聚合 RPC（server fan-out + 有界契约：q 预
      过滤 / limit 1..500 默认 200 / nextCursor 分段 + 单 provider typed
      error 投影 + duplicates 合并；单测覆盖四态 + 有界分段与 limit 越界
      typed 拒绝）
- [x] 1.2 mobileScreen 网格壳（auto-fill + container query 单列回落 + 一栏
      容器不溢出断言 + screen header/body 分层）
- [x] 1.3 Skills screen：平铺列表 + 搜索 + provider chips + duplicates 过滤 +
      虚拟化窗口 + master-detail（skill-detail-panel 抽自 ProviderView；
      只读文档 + 管理动作，行内轻量编辑退役归 Creator 深链）
- [x] 1.4 Agents screen：provider 卡片 + 筛选联动 + intelligence 入口迁移
- [x] 1.5 Repos screen：RepositoryHome/RepositoryScan 迁入 + scan 路由迁移 +
      安装目标预填当前 ws
- [x] 1.6 WorkspacesHome 退役（库快照/self-skill banner 随迁 Global 页脚；
      冒烟锚点 en 逐字不变）
- [x] 1.7 IntelligenceView 路由收敛迁移 + 双入口同链断言
- [x] 1.8 Repository/Workspaces app manifest 删除 + redirect 更新
- [x] 1.9 i18n（引用制，r2 修订）：完成时在 webui-i18n-bilingual 的
      inventory.md 标记对应 B 类面完成并双语适配（唯一帐本 = 该 change）
- [ ] 1.10 验证门：全量测试绿 + webui check + ego-browser 走查（网格 1/2/3
      列 + 单列容器不溢出）+ vision 验收 + 进程回收证据
