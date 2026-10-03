# Design: shell-page-tabs

> Owner 17 题裁决（WorkFile g1#D7-D17）+ Codex r1 联审（A1/A2/A3/H）+ T0 品类
> 地板（/tmp/ia-redesign/t0-genre-floor.md）的固化契约。冲突时以 Owner 原话为准。

## 1. URL 与路由模型

### 1.1 显示 URL 与真实 path（r2 修订：定位定稿）

```text
显示（omnibox）                      浏览器真实 path
─────────────────────────────      ─────────────────────────────
skill-creator://w/~/skills          /w/~/skills
skill-creator://w/proj-a/skills?q=… /w/proj-a/skills?q=…
skill-creator://w/proj-a/wiki       /w/proj-a/wiki
skill-creator://agent               /agent
skill-creator://settings/model      /settings/model
```

- **定位裁决**：`skill-creator://` 是**显示层 scheme + 可粘贴语法**——omnibox
  渲染为前缀；用户粘贴时解析器同时接受带 scheme 与裸 path 两种形式（strip
  scheme 后走 path 解析），复制时携带 scheme。它不是网络协议，不承诺浏览器
  地址栏可直接打开。
- `:wsId` 用现有 WorkspaceIdSchema（Global = `~`，URL 中 `~` 直接使用；wiki
  旧实现的 `%7E` 编码在 redirect 时归一为 `~`）。
- search 参数维持现有 search schema 机制（Zod load-time 收窄不变）。

### 1.2 Page 与 route registry

AppManifest 从「app = 顶级路径前缀」升级为「app = Page 实例工厂」：

```text
SkillsWorkspacePage（kind: workspace）
  manifest: skills/creator/wiki/evaluating 四个 nav 区块，absolutePattern
  挂 /w/:wsId/<block>/*；同一组 manifest 参数化实例化到任意 wsId。
SkillsAgentPage（kind: agent, 固定）
  manifest: agent app，/agent*。
SettingsPage（kind: settings, 按需）
  manifest: settings app，/settings*。
```

registry 的 `findByPath` 匹配升级为两级：先 Page kind 段（/w/:wsId 前缀 or
固定段），再区块 pattern。`AppActivity.pattern` 允许携带 `:wsId` 参数段
（match 层已有 decodeURIComponent + Zod 收窄先例）。

### 1.3 tab 路由历史（app-owned per-tab 栈；r2 修订）

> r1/r0 方案（tab 内 pushState + 切 tab replaceState）已被 Codex r2 证伪：浏览器
> 只有一条全局历史，replaceState 切 tab 会覆写当前 entry（相邻 tab 的最后一条
> 被破坏），Back/Forward 仍可能跨 tab。修订为 **tab 栈为真相、浏览器历史恒定
> 深度** 的 app-owned 方案：

```text
每 tab：entries: string[] + cursor          // app-owned 页面栈与指针（真相）
应用内导航：push 进当前 tab 栈（cursor 后截断）；浏览器 replaceState 同步地址
tab 内 Back/Forward：移动 cursor（栈指针）；replaceState 同步地址
切 tab：不触碰任何栈；replaceState 到目标 tab 的当前 entry
```

- **浏览器 history 深度恒定**（全部 replaceState）：全局 Back 键不导航应用
  （桌面 WebView 场景该键本就无语义；web 模式浏览器中 Back = 离开应用，与
  SPA 现状一致）——从根上消灭跨 tab 串线（r1 P0 风险的解）。
- **应用内导航控件**：omnibox 行左端 Back/Forward 按钮（启用态随当前 tab 栈
  cursor 派生）+ 键盘 ⌘[ / ⌘]（macOS 惯例）——浏览器原生键被接管后由应用
  承接同类肌肉记忆（T0「never copy 导航钮」项就此翻案，理由：单浏览器 tab
  装多虚拟 tab 时它是必需品，不是装饰）。
- 栈持久化见 §2.1（entries + cursor 全量入 tab session，刷新恢复完整栈）。
- popstate 处理：仅响应外部 hash/token 变化场景，导航语义全部走应用控件；
  popstate 到未知路径 → route-hygiene 收敛（redirect/重置当前 entry）。
- 禁止在 $effect 内同步 throw（Svelte 5.57 僵尸分支）；所有 tab 恢复逻辑
  async 化 + 连接门，照抄 ProviderView 范本。

### 1.4 redirect 表（破坏性迁移 + 窄范围入口 redirect；r3 修订：provider 身份保留）

```text
旧 path                                → 新 canonical（参数保留规则）
─────────────────────────────────────  ─────────────────────────────────────
/workspaces                            → /w/~/skills
/workspaces/:ws/:prov                  → /w/:ws/skills?provider=:prov
                                         （旧 ?q= → ?q=；旧 ?skill= →
                                          ?provider=:prov&skill=:skill——
                                          skillId 是 per-provider digest，
                                          详情恢复必须 provider+skill 双参数；
                                          旧 ?view=detail 由 ?skill= 存在性
                                          表达，?view=list 丢弃 view 段）
/workspaces/intelligence/:ws/:p        → /w/:ws/skills/intelligence/:p
                                         （旧 ?severity= → ?severity=）
/creator                               → /w/~/creator（无身份首屏）
/creator/edit/:ws/:p/:skill?subview=s&template=t
                                       → /w/:ws/creator/edit/:p/:skill?subview=s
                                         &template=t
/creator/new/:ws/:p?template=t         → /w/:ws/creator/new/:p?template=t
/wiki                                  → /w/~/wiki
/wiki/:ws                              → /w/:ws/wiki
/repository                            → /w/~/skills（dashboard 落地前暂定）
/repository/scan/:sourceId?selected=s&targets=t&skill=k
                                       → 暂定 /w/~/skills（dashboard 落地后
                                         更新为 Repos 深链，scan 参数全保）
/settings…                             → /settings…（原样，仅壳变化）
```

- redirect 在 route-hygiene 层（渲染前）执行，replace 一次即达 canonical，不留
  中间态。非法/缺失身份（如 /creator/edit 的 ws 不在 registry）仍渲染前
  redirect（现有纪律）。
- 每个 redirect 的参数映射有表可查（上表）且逐条测试钉死（r1 P1「路由迁移
  漏项」的解）。

## 2. tab 状态机

### 2.1 状态形状（localStorage `skill-creator.tabs.v1`）

```ts
{
  version: 1,
  order: ["~", "ws_abc123"],        // tab 顺序；"~" 恒第一位；agent/settings
                                     // tab 不入 order（固定/按需，见 2.2）
  stacks: {                          // r2 修订：持久化完整 per-tab 栈（不只当前 route）
    "~":        { entries: ["/w/~/skills"], cursor: 0 },
    "ws_abc123": { entries: ["/w/w…/creator", "/w/w…/creator/edit/x"], cursor: 1 }
  }
}
```

- SkillsAgentPage 固定存在，不入持久化（恢复时恒在）。
- SettingsPage **不持久化**（刷新后不开——设置是临时查看面；r2 修订：此为已
  定默认非待拍板，验收走查如需「恢复设置 tab」再升格）。
- 恢复时校验 wsId 仍存在于 workspace.list 投影；不存在的 tab 静默丢弃。
- safeParse 失败 → 空 tab 集（只保留 Global + Agent 固定页）——破坏性更新
  无兼容策略；IO 错误（QuotaExceeded 等）类型化降级为内存态。

### 2.2 tab 栏行为

- `~`（label「Global」+地球图标）与 Agent tab（message-square 图标）固定
  不可关闭、不可拖出；Imported tabs 可关（× / 右键菜单 Close）。
- `＋` = 菜单：已导入未打开的 workspaces（点击开 tab）+「Import directory…」
  （复用 ImportWorkspaceDialog）。菜单数据 = workspace.list 投影，不新增 RPC。
- tab 右键菜单：Close / Copy path / Open in file manager / Remove workspace…
  （Remove 二次确认走现有 remove 流程；触发后清理其恢复记录）。
- 关闭含活跃 tab 的 tab：激活邻位 tab；全关只剩固定两 tab。
- workspace 新导入：追加 tab 并激活。workspace 被移除：若其 tab 在栏上，关
  闭该 tab。

## 3. omnibox

### 3.1 双态

```text
显示态：scheme + path（等宽字体 muted），点击 / ⌘L / F6 聚焦
编辑态：input 全选 path 文本；Esc 还原；Enter 解析跳转
导航钮：omnibox 行左端 Back / Forward（启用态 = 当前 tab 栈 cursor 可移动性；
        ⌘[ / ⌘] 快捷键；见 §1.3 app-owned 栈）
```

### 3.2 解析与补全（共享内核）

- 输入以 `> ` 开头 → 命令模式：补全源 = command-palette 的命令注册表
  （内核合并点：抽 `lib/shell/commands.ts` 注册表，palette 与 omnibox 双消费）。
- 其余输入 → 路径/对象补全：
  1. path 前缀匹配页面路由（w/<ws>/skills|creator|wiki|evaluating、agent、
     settings）；
  2. workspace 名/标签前缀（切 tab）；
  3. 技能名（skills.search 现有 RPC，模糊，限 top-8）——直达
     `/w/:ws/skills?skill=…`。
- Enter：命中补全项跳转；纯 path 可粘贴完整路径（含 query，带或不带
  `skill-creator://` scheme）解析跳转；无法解析 → 抖动 + 保留输入（不静默
  清空）。
- 下拉补全面板键盘导航（↑↓ Enter Esc），复用 palette 的列表交互模式。

### 3.3 actions per Page

```ts
type PageActions = readonly PageAction[]  // 由各 Page app manifest 声明
SkillsWorkspacePage → [agent]            // 现有 AgentPanel drawer 开关（本 change 不迁移挂载）
SkillsAgentPage     → [terminal, rightPanel]  // 占位禁用态（实体后续 change）
SettingsPage        → [themeToggle]
```

右上角 settings 齿轮恒在（所有 Page 一致），从 WindowDragRegion 右侧工具组
迁到 omnibox 行 actions 尾部。

## 4. 布局与三尺寸

```text
≥1024   tab strip(36px) + omnibox(36px) + [左导航展开 200px | 内容]
720-1024 同上；左导航折叠图标条（现有 AppSidebar 双态）
<720    tab 横滚；omnibox actions 收溢出菜单；左导航 drawer（现有语义）
```

- drag region = tab strip 空白处（tab 与 ＋ 之外）；macOS traffic lights /
  Windows caption 几何由 WindowDragRegion 现有平台处理迁移（不变式：caption
  让位区两侧）。
- 两行总高 72px 是 P2 验收关注点（窄屏内容挤压）；窄屏 omnibox 行可与 tab
  strip 合并滚动的降级方案留 tasks 备选。

## 5. 左导航（SkillsWorkspacePage 专属）

- 四项：Skills / Creator / Wiki / Evaluating（新增，本 change 占位空态页：
  标题 + 「per-skill evaluation dashboard 归 evaluating-dashboard change」
  说明 + 返回 Skills 链接）。
- 项的可用性按 ws 投影：Global 上 Creator 项沿用 writable 门控哲学——显示但
  进入后引导切换到 Imported workspace（现状 ProviderView 的 Edit in Creator
  按 editable 门控不显示；导航项不隐藏，页面内空态引导，避免「导航项忽隐忽
  现」）。
- 导航状态 = URL 区块段派生（无独立 store）；每 ws 的区块记忆由 tab route
  天然携带。

## 6. 测试面

- `path-pattern` / `match`：Page 前缀参数段（:wsId）新用例。
- `route-hygiene`：redirect 表逐条（含参数保留映射）+ 非法 wsId 渲染前
  redirect。
- tab 栈：push/截断/back/forward 纯函数单测；栈持久化往返；恢复丢失效 ws；
  version 升级丢弃；Quota 降级。
- per-tab 隔离（r1 P0 验收）：多 tab 并发导航后逐 tab Back/Forward 不跨 tab；
  切 tab 往返各 tab 栈保持；浏览器全局 history 深度恒定断言。
- omnibox：解析纯函数（path 补全排序 / `> ` 模式切换 / 带 scheme 与裸 path
  粘贴 / 非法输入）单测；补全面板交互 dom 测试；⌘[ / ⌘] 快捷键映射。
- web-mode-smoke：锚点文本 en 逐字不变，断言路径随挂载点更新。
- 手动验收：桌面 + 窄屏 ego-browser 走查（tab 切换/恢复/＋导入/omnibox 三类
  补全/per-tab Back 隔离/caption 安全区）。

## 7. 非目标

- dashboard / AgentChat / evaluating 实体（后续 change）。
- AgentPanel 迁移为 per-workspace attach（skills-agent-page change）。
- AgentPage / terminal / rightPanel 实体。
- per-tab 的滚动位置/焦点精细恢复（P2 清单，验收时若断则单列批任务）。
