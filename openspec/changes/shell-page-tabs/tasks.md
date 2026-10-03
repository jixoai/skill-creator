# Tasks: shell-page-tabs

## 1. 路由地基

- [x] 1.1 route registry 升级：AppActivity.pattern 支持 `:wsId` 参数段；
      findByPath 两级匹配（Page kind 段 + 区块 pattern）
- [x] 1.2 五个 app manifest 迁移 absolutePattern（/w/:wsId/… 四区块 + /agent + /settings）；agent app 新建占位（空态组件）
- [x] 1.3 redirect 表 + route-hygiene 接线（旧 /workspaces|/creator|/wiki|
      /repository → 新 canonical；wiki %7E 归一）
- [x] 1.4 path-pattern / match 测试重写（:wsId 段用例全量）
- [x] 1.5 web-mode-smoke 锚点迁移（en 逐字不变）+ 走查脚本更新

## 2. tab 状态机

- [x] 2.1 tab session store（version 1 schema 含 per-tab stacks + localStorage
      读写 + safeParse 失败投影空集 + Quota 类型化降级）
- [x] 2.2 tab strip 组件（固定 Global/Agent tab + Imported tabs + ＋菜单 +
      右键管理菜单 + 溢出横滚 + drag region 集成）
- [x] 2.3 app-owned per-tab 栈（push/截断/back/forward 纯函数 + 浏览器
      replaceState 同步 + 切 tab 不触栈 + popstate 收敛 + 恢复）
- [x] 2.4 workspace 生命周期接线（导入追加 tab / 移除关 tab + 清恢复记录；
      Close ≠ Remove 断言测试；活跃 tab 关闭/刷新/workspace 消失竞态）
- [x] 2.5 Back/Forward 导航钮（omnibox 行左端 + ⌘[ / ⌘] + 启用态派生）+
      tab 栈与隔离单测（多 tab 导航互不串线）

## 3. omnibox

- [ ] 3.1 命令注册表抽核（lib/shell/commands.ts：palette 与 omnibox 双消费）
- [ ] 3.2 omnibox 组件（显示/编辑双态 + scheme 前缀渲染 + ⌘L/F6 聚焦）
- [ ] 3.3 解析与补全内核（path 前缀 / workspace / skills.search 模糊 / `> `
      命令模式；纯函数单测）
- [ ] 3.4 补全下拉面板（键盘导航 + dom 测试）
- [ ] 3.5 actions per Page 机制 + settings 齿枪迁位 + theme-toggle（settings
      actions）+ agent action（开现有 AgentPanel）+ terminal/rightPanel 占位禁用

## 4. 壳与导航

- [x] 4.1 +layout.svelte 重构（两行顶部 + PageOutlet + 左导航仅 Workspace
      Page 渲染）
- [ ] 4.2 AppSidebar 收敛为 SkillsWorkspacePage 内组件（四项 + Global 的
      Creator 引导空态）
- [ ] 4.3 evaluating 占位空态页
- [ ] 4.4 窄屏/平台：tab 横滚 + actions 溢出 + caption 安全区（macOS/Windows）
- [ ] 4.5 现有视图过渡挂载验证（ProviderView/Wiki/CreatorWorkspace 于新壳内
      功能不回归）

## 5. 验证门

- [x] 5.1 `pnpm --dir webui check` 0 error；`pnpm exec vp test run` 全量绿
- [ ] 5.2 ego-browser 走查：桌面+窄屏（tab 切换恢复/＋导入/omnibox 三类补全/
      per-tab Back 隔离/caption 安全区/左导航 drawer）
- [ ] 5.3 vision 子代理视觉验收（胶囊 tab/两行密度/对比度）
- [ ] 5.4 残留进程回收审计（走查 daemon PID 证据）

## 已定裁决（r2 修订落定，非待确认）

- SettingsPage 不持久化（刷新后不开）——已定默认，验收走查可升格。
- repository 过渡 redirect 目标 /w/~/skills（dashboard 前暂定，参数保留全表
  在 design §1.4）。
- `skill-creator://` = 显示层 scheme + 可粘贴语法（非网络协议）。
- per-tab 历史 = app-owned 栈 + 浏览器 history 深度恒定（design §1.3）。
