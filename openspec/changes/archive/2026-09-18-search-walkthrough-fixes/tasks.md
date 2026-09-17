# Tasks

- [x] 1.1 ranking v2：池前 contentHash 分组折叠（组代表 bm25 desc →
      canonicalPath asc 进 top-40）+ primary installations 合并去重 +
      RANKING_VERSION 递增
- [x] 1.2 单测：34 副本挤池场景断言多样性、installations 合并、
      path 共享三元组去重；既有折叠/tie-break 用例适配
- [x] 1.3 关联测试（index/service/rpc/benchmark）全绿；基准
      R@5=0.993 / MRR=0.959 不回退
- [x] 2.1 WorkspacesHome 删「同内容技能」区块 + duplicates 加载链
- [x] 2.2 ProviderView duplicates latch（连接后单发）+ id → 同源计数映射
- [x] 2.3 SkillCard `sameContentCount` 角标（symlink 式箭头 + title）+
      搜索结果行同源角标（duplicates.length）
- [x] 2.4 真实语料端到端走查：首页无区块、amp 行 11/11 角标、
      q=cloudflare 10 行结果、q=zzz 明确空态、MCP 面 8 内容结果且每条
      携带全量 installations
- [x] 3.1 UI 品味第一轮（vision 初审）：列表栏 clamp + 详情 48rem 容器 +
      走查面 10/11px 字号清零 + 首页 max-w-5xl + hover 统一 muted + 嵌套卡
      去边框 + 同源角标加计数 + Insights/Updates icon-only + 行图标降灰 +
      rail active 态
- [x] 3.2 vision 复审 8 项判定生效；P1-B（"3 of 11" 与全量并存）经程序化
      证据证伪不采纳（代码无此文案、CDP 实测搜索过滤生效 rows 11→10）
- [x] 3.3 复审真问题修复：P1-A 搜索行点击改选本地技能（全局 canonical id
      不再传 provider 作用域详情 RPC，CDP 验证正常详情渲染）；P2-C 错误
      文案分层（主文案 + muted 排障小字）；P2-D 列表宽固定 22rem（cqw 随
      Agent 面板跳变）；P2-E quick 卡图标中性色；P2-F 空态 my-auto 居中
