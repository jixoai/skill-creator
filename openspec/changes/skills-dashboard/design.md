# Design: skills-dashboard

## 1. mobileScreen 网格（Owner Q4/Q11 裁决；r2 修订：单列回落显式化）

```css
.dashboard-shell { container-type: inline-size; container-name: dashboard; }
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px;
}
.screen { height: var(--screen-h, 480px); overflow: hidden; display: flex; flex-direction: column; }
.screen > .screen-body { overflow-y: auto; min-height: 0; }
.skills-screen { grid-column: span 2; }   /* 主屏双列起步（2 列网格 = 占满整行）*/

/* r2 修订：CSS Grid 不保证 span 2 在单列网格自然回落（1 列显式网格内
   span 2 会创建隐式第二列导致横向溢出）——以 container query 显式降档。
   阈值 = 2×minmax 轨道 + 1×gap = 692px：容器窄于它时 auto-fill 只能解析
   出 1 列。 */
@container dashboard (width < 692px) {
  .skills-screen { grid-column: span 1; }
}
```

- 每个 screen 是稳定设备屏隐喻：**固定高、内部滚动、自带 header**（标题 +
  计数 + 屏内动作）；网格换行时高度不塌（不随内容长高）。
- 响应式列数由 auto-fill 承担：宽 1/2/3/4 列自适应（Owner 原话语义）；
  Skills 主屏在 ≥2 列网格 `span 2`，单列容器经 container query 显式降为
  `span 1`（r2 修订：原「自然回落」主张不成立）。
- **一栏容器不溢出**是测试要求（§7）：单列宽度下 grid 容器
  `scrollWidth ≤ clientWidth`，不得出现隐式列横向滚动。
- screen 高度用 CSS 自定义属性，未来可拖拽调高（非本批）。

## 2. Skills screen（主屏）

- 数据：`skills.listWorkspace({ wsId, q?, limit, cursor })`（§5 有界契约；
  「load more」经 nextCursor 追加）→ 平铺 rows（name/desc/provider/
  enabled/duplicates 角标）。
- 搜索框（skills.search 模糊，top-N 延迟补全式）+ provider chips（All +
  每 provider 计数）+ duplicates-only 过滤开关。
- 行点击 → 详情面：屏幕内 master-detail（宽屏右侧滑入详情卡 / 窄屏 push
  详情视图）。**详情恢复身份 = provider+skill 双参数**（r3 修订）：URL search
  `?provider=:p&skill=:sk`——skillId 是 per-provider digest，聚合列表跨
  provider，单 `?skill=` 无法无歧义定位（同名技能跨 provider 安装是常态）。
- **detail 编辑所有权切分（r2 修订，与 creator-agent-chat 同源）**：detail =
  只读文档详情 + 管理动作；frontmatter/正文编辑唯一真相 = Creator 编辑页。
  现 ProviderView 的 name/description 行内轻量编辑（正交意图 3）随迁移
  **退役**（不迁移）。按钮归属清单：

```text
留 Dashboard detail（本 change 所有）：
  文档查看（frontmatter 解析 + markdown 正文，只读渲染）
  Validate（只读校验）
  Update check（只读检查；update apply 不在此面）
  Toggle enable/disable（skills 域唯一写 RPC = skills.toggle，启停管理非编辑）
  Chat about this skill（agent 域动作：agent.session.create/agent.*，见下例外）
  Edit in Creator（深链 /w/:wsId/creator/edit/:providerId/:skillId）
归 Creator 编辑页（唯一编辑真相）：
  name/description 行内轻量编辑（现 ProviderView，退役）
  frontmatter/正文编辑 + Save（revision 闸）
  Delete（revision-checked）
  change log / 模板
```

- **「零写」约束的准确边界（r3 修订）**：detail 面的测试断言是「**skills 域
  零写 RPC、无 creator.save/delete 调用**」（skills.toggle 除外）；「Chat
  about this skill」经 agent 域过程（会话创建/发送）发起，不属于 skills 域
  写——它是 creator-agent-chat 的入口，本 change 只放按钮位。

- Global 下沿用 editable 门控：不可写 provider 不显示 Edit 深链钮；toggle/
  validate 沿现有 per-target 门控。
- 虚拟滚动：>200 rows 时列表虚拟化（现 ProviderView 无虚拟化，本 change 引入
  简单窗口化，避免回归）。虚拟化只减 DOM；服务端成本由 §5 有界契约承担。

## 3. Agents screen

- provider 卡片列表：agent 名 / root 路径 / skill 计数 / 可写性徽标；点击 =
  主屏 provider 筛选联动（chips 选中态同步）。
- intelligence 入口：per-provider 「View findings」→
  `/w/:wsId/skills/intelligence/:providerId`（IntelligenceView 迁移挂载，
  路由收敛一处；skill 详情的 finding 入口同链）。
- 展示 provider catalog 投影（现有 workspace.list 的 providers 数据源，无新
  RPC）。

## 4. Repos screen

- RepositoryHome/RepositoryScan 组件迁入 screen 容器（pinned-clone → preview/
  install 状态机原样；scan 实例路由迁 `/w/:wsId/skills/repos/scan/:sourceId`）。
- screen 内导航：Discover 列表 → scan 视图（screen 内替换，返回保留会话）；
  安装目标选择器按当前 tab 的 wsId 预填（Imported 才可选；Global 只读空态
  引导）。
- user source 管理（add/remove https-only）沿现有 sourceRegistry 契约。

## 5. 聚合 RPC `skills.listWorkspace`（r2 修订：有界契约 + typed per-provider error）

```ts
input:  {
  wsId: WorkspaceIdSchema,
  q?: string,          // 可选 server 端预过滤（name/description 包含式）
  limit?: 1..500,      // 默认 200；> 500 = typed 校验错误（沿 skills.search limit 纪律）
  cursor?: string      // opaque 分段游标（回传上页 nextCursor）
}
output: {
  providers: Array<{
    providerId, label, available, skillCount,
    error?: { code: "unavailable" | "scan-failed" | "io-error", message: string }
  }>,
  skills: Array<SkillRow>,          // 全 provider 平铺（含 providerId 归属）；长度恒 ≤ limit
                                     // 排序 (providerId, skillId) 字典序
  nextCursor?: string,              // 截断时出现；缺席 = 已到末段
  duplicates: {                     // r3/r4：双层有界投影（非完整 duplicates 面）
    groups: Array<{                            // ≤ 50 组（groupsTruncated 标志）
      contentHash: string,
      members: Array<{                         // 每组 ≤ 16（membersTruncated）
        ...SkillDuplicateMember,               // 除 installations 外同形
        installations: { items: Installation[] /* ≤ 8 */, truncated: boolean }
      }>,
      membersTruncated: boolean
    }>,
    groupsTruncated: boolean       // true = 组数达上限，全量走 skills.duplicates
  }
}
```

- **有界性是契约而非实现细节**（r2/r3 修订）：provider 数量少不构成无界豁免
  ——技能数与 provider 数无关，UI 虚拟化只减 DOM 不减服务端成本。单次响应
  `skills` 恒 ≤ limit，超出经 `nextCursor` 分段（UI「load more」追加）。
  **duplicates 同受有界约束（双层 + 成员级，r4 定稿）**：不沿用完整投影，
  投影为 schema 块中的 `duplicates` 对象——组 ≤ 50（`groupsTruncated`）/
  每组成员 ≤ 16（`membersTruncated`）/ 每成员 installations ≤ 8；成员的
  `installations` 投影为 `{ items: Installation[] /* ≤8 */, truncated:
  boolean }`（成员级截断显式标志，非隐式丢弃）。任一 truncated = true 时
  UI 提示经 `skills.duplicates` 全量查询；整响应规模因此恒有界。
- 排序与游标稳定（r3）：skills 行按 `(providerId, skillId)` 字典序；nextCursor
  = 下一首行键编码，续页严格不重不漏（q 过滤下同序）。
- 单 provider 失败 → 该 provider `error`（typed code 闭集，schema 字段）+
  该 provider skills 缺席，整屏不失败（r2 修订：error 从注释升格为 schema
  字段）。
- Global（~）与其他 ws 同形（只读语义在写入动作层门控，列表无差别；本 RPC
  无写入面，不设写闸 SHALL）。
- fan-out 复用 skill-registry 既有 discovery 语义（单遍扫描/在途合并/
  mutation 后失效），不引入第二条扫描路径。
- 契约 delta 见 `specs/skill-registry/spec.md`（有界性与 per-provider 隔离
  为 spec 级 Requirement）。

## 6. 迁移与退役

- ProviderView：detail 面抽为 `components/skills/skill-detail-panel.svelte`；
  list 部分重写为平铺（1095 行拆分，detail 复用迁移；name/description
  行内轻量编辑代码删除不迁移——r2 修订）。
- WorkspacesHome 退役：库快照行/self-skill banner → Global tab skills 屏页脚
  （冒烟锚点随迁 en 逐字）；位置索引区删除（Agents screen 取代）。
- IntelligenceView 组件原样迁移挂载（路由换前缀）。
- Repository manifest 删除；shell-page-tabs 的 redirect 更新为 Repos 深链。

## 7. 测试

- listWorkspace 聚合：正常 / 单 provider 失败（typed error 投影 + 该
  provider skills 缺席）/ 空 ws / duplicates 投影 / 有界分段（默认 200 截断
  + nextCursor 续拉到尾 / limit>500 typed 拒绝）。
- 平铺列表 + 筛选 + 搜索联动（store 纯函数单测）。
- 迁移 redirect 更新 + scan 会话流回归（安装/预览状态机不回归）。
- mobileScreen 网格 dom 测试：container query 单列回落（span 1）+ 一栏容器
  不溢出断言（grid 容器 scrollWidth ≤ clientWidth）/ screen 内滚不冒泡。
- detail 面编辑所有权：除 skills.toggle 外零写 RPC、无 creator.save 调用
  （源扫描断言模式）。
