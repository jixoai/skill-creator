# ccski-3-host-migration 批 4 · dev 沙箱全链走查证据（walkthrough-evidence）

> 环境：标准 `pnpm dev`（自动停生产 daemon PID 10556——预期行为，走查后恢复）；
> dev home = `/tmp/sc-v2/.skill-creator`（隔离，未触碰真实 `~/.agents` / `~/.skill-creator`）；
> dev daemon PID 65125（第二次启动；首次 61223，为让搜索索引收录 post-boot 导入的
> walkthrough ws roots 重启一次，见 W3-b 记录）；Vite http://localhost:5174；
> walkthrough workspace = `/tmp/ccski3-walkthrough/ws`（Imported，id
> `ws_f974027dc6a8b1e6ab02724a`）。证据方式 = 浏览器内 eval 断言 + DOM 度量 +
> 文件系统/内核 state 实证（agent-browser 会话 `zcode-ccski3-walkthrough`；
> CDP 截图 1 张 bonus：`/tmp/ccski3-walkthrough/final-skills-list.png`——本机
> 截图管线可用则截，不作为断言依据）。走查源 = curated 源 Anthropic Skills
> （https://github.com/anthropics/skills）。

## 走查链逐步三元组（操作 / 断言 / 结果）

### W1 导入 Imported Workspace

- 操作：workspace tab 菜单 → Import directory… → 填入 `/tmp/ccski3-walkthrough/ws`，
  label `ccski3-walkthrough` → Import。
- 断言：tab 出现且选中；URL 切到该 ws。
- 结果：**通过**（tab "ccski3-walkthrough /private/tmp/ccski3-walkthrough/ws"
  [selected]；URL `/w/ws_f974027dc6a8b1e6ab02724a/skills`）。

### W2 Repository 安装（pin commit → preview → install）

- 操作：Discover repos → Anthropic Skills 卡片 Scan → 扫描实例
  `/w/<ws>/skills/repos/scan/anthropics-skills` 自动 pinned 浅克隆扫描 → 勾选
  `doc-coauthoring`（rsk_42e980c426804a215c7b1e56）→ 行点击 Preview（正文渲染）
  → Install targets 仅勾 `ccski3-walkthrough / Claude Code` → Install。
- 断言：
  1. pin commit 与上游 HEAD 一致：`git ls-remote` = `683bc88e56f3e09ba…`，
     UI scan-meta = `20 skills · commit 683bc88e56f3`（**通过**）；
  2. install 汇总 = `Installed 1 · overwritten 0 · skipped 0 · failed 0`（**通过**）；
  3. 文件系统两阶段物理：实体 `<ws>/.agents/skills/doc-coauthoring`（**通过**）+
     投影 symlink `<ws>/.claude/skills/doc-coauthoring → 实体`（**通过**）；
  4. 内核 state：entities[`doc-coauthoring`] + projection
     `d8e3e0c3d4d45865:doc-coauthoring`（mode=link, disabled=false,
     rootPath=`<ws>/.claude/skills`）（**通过**）；
  5. 内容保真：`diff -r <实体> <上游克隆 skills/doc-coauthoring>` =
     CONTENT-IDENTICAL（**通过**）。

### W3 Skills 页唯一逻辑名列表 + duplicates 角标

- 操作：打开 `/w/<ws>/skills`（默认视图）。
- 断言：唯一逻辑名分组——物理上 2 个位置（实体 + 链接）× 20 个 provider face
  （19 个 agent 的 workspacePath 同为 `.agents/skills` + claude-code `.claude/skills`）
  只显示 1 组；header = `1 skill group · 20 installations`（两量纲分开）；
  provider chips 组代表口径（Amp 1）。
- 结果：**通过**（rowCount=1，group=doc-coauthoring，×20 徽标 aria "20 copies"）。
  ——20 face 的语义正确：多个 Agent 社区约定共享 `.agents/skills`，每个 provider
  face 计数一次，canonical 身份（realpath 去重）单一（sk_222fa266c975c2fa87d0f177
  在 amp/claude-code 两 detail 副本同 id）。

### W3-b duplicates 角标（同内容 ≥2 canonical）

- 操作：先在无重复时开 `?duplicates=1`（基线）；再植入真实内容重复
  （`cp -R <实体> <ws>/.claude/skills/doc-coauthoring-manual`，普通目录副本，
  frontmatter 同名同内容）。
- 断言：基线 duplicates-only = 0 行（"No skills"）；植入后索引出现第二个
  canonical（contentHash `2e47d78846fa…` 两行全等）；`?duplicates=1` 恰好显示
  doc-coauthoring 组；总数变 `1 skill group · 21 installations`。
- 结果：**通过**（0 → 1 行；sqlite 索引实证两 canonical 同 hash）。
- 记录（走查发现 F-1，非本批引入）：**post-boot 导入的 workspace roots 不在
  搜索索引 watcher 的 watch 集**——导入后植入/修改文件不触发维护，duplicates/
  search 面看不到该 ws 技能，直到任一已 watch root 产生事件或 daemon 重启
  （走查中通过重启 dev daemon 收敛）。索引 roots 枚举在维护路径
  （skill-search/service.ts `resolveRoots`）按 registry 持久态实时解析，缺的是
  workspace.add 后的主动失效/新 root 增量 watch。属 search-index 新鲜度既有缺口，
  建议后续批次处理。

### W4 SkillDetail（treeView + CodeEditor 读实体内容 + 双路径）

- 操作：列表行点击 → detail `/w/<ws>/skills/claude-code/sk_222fa…`；
  副本组区点击 claude-code 副本；文件树点击 SKILL.md。
- 断言：
  1. 双路径（批 3.3）展示
     `/private/tmp/…/ws/.agents/skills/doc-coauthoring ⇢ /private/tmp/…/ws/.claude/skills/doc-coauthoring`
     （实体路径恒显 + 投影路径不同时追加）（**通过**）；
  2. 启停文案（批 3.4）toggle title =
     "Disable — removes this skill's symlink from the provider root; content stays
     the skill library"（ccski link 投影语义）（**通过**）；
  3. 文件树列出 SKILL.md；内容查看器渲染实体真实正文（快照含 "Stage 3: Reader
     Testing"/"Quality Checking" 等实文）（**通过**——经 symlink 投影读实体）；
  4. 副本组 20 行、provider 徽标、代表标记（amp 为代表——enabled 优先序）
     （**通过**）。

### W5 toggle 禁用（物理摘链；列表仍见 disabled 行 = 批 3.2 生效）

- 操作：claude-code 副本 detail → Disable。
- 断言：
  1. 物理摘链：`<ws>/.claude/skills/` 为空（link 不在）（**通过**）；
  2. 实体完好：`<实体>/SKILL.md` 在场（**通过**）；
  3. 内核 state：projection disabled=true（**通过**）；
  4. **批 3.2 核心**：返回 `/w/<ws>/skills` 列表组仍在（1 组）；组内 ×20 副本
     （19 entity face + 1 state 补充行）；副本组区 claude-code 行显示
     "claude-code Disabled" 徽标（disabled 补充行并入逻辑名分组）（**通过**）；
  5. detail 面转 Enable，title = "Enable — recreates the symlink from the skill
     library"（**通过**）；
  6. disabled 补充行详情可读（skillFile 对侧回退到实体 enabled 形态 SKILL.md）
     （**通过**——W6 前置）。

### W6 再启用（链接重建，往返闭合）

- 操作：disabled 补充行 detail → Enable。
- 断言：symlink 重建
  `<ws>/.claude/skills/doc-coauthoring → <ws>/.agents/skills/doc-coauthoring`；
  state disabled=false；同 id（sk_222fa…）不变。
- 结果：**通过**（禁用→启用全链 UI 往返闭合；批 2 遗留边界解除）。

### W7 skills update（check → apply）

- 操作 A（产品面，repository 安装技能）：SkillDetail → "Update check" 点击。
- 断言 A：无更新徽标、无错误 toast——repository 安装技能无 skills-CLI lock/
  probe 记录，check 无候选（诚实空，不伪装成功）（**通过**；页内 "current" 字样
  实为技能正文文本，非更新徽标）。
- 操作 B（CLI 面，隔离 lock 沙箱）：walkthrough ws 内项目锁
  `<ws>/skills-lock.json`（v1，computedHash=40-hex 旧代际）+ `XDG_STATE_HOME`
  沙箱全局锁（v3）；`npx skills list --json`（cwd=ws）实测列出该技能（canonical
  路径命中 probe 面）→ `skill-creator skills update check/apply`。
- 断言 B：check 输出 `{"results":[]}`；apply 输出
  `failed — Skill is not tracked by the skills CLI.`（typed 拒绝，exit 1）。
- 结果 B：**如上记录**——根因是走查发现 F-2（见下），非 lock/内核路径问题；
  真实内核 update 链（computeSkillFolderHash 单源 + updateEntity + 40-hex stale
  收敛 + lockSyncPending）以批 2 契约测试 36/36（真实内核）为收据。
- **走查发现 F-2（批 2 之外的既有缺口，建议后续批次修复）**：CLI 短命进程
  `probeWarmup:false`（cli-surface-parity D1）下，`skills list` 投影时 probe 未
  预热 → `updatable` 冻结为 false；`update check/apply` 的候选门
  （`!probeMap.has(path) || !skill.updatable`，skills-update-service.ts:776 等）
  读的是 list 时冻结的 flag → 短命 CLI 的 update 两面恒空/恒拒。修法方向：CLI
  update 命令先 `probe()` 再 list，或 check/apply 以当次 probeMap 重导 candidacy。

### W8 remove（Creator 删除）

- 操作：Creator edit `/creator/edit/<ws>/amp/sk_222fa…` → Delete → 确认对话框
  Delete。
- 断言：实体目录删除（`<ws>/.agents/skills/` 空）；`.claude/skills` 下 symlink
  悬空残留；manual copy 在场；Skills 页诚实收敛为 `1 skill group · 1
installation`（悬空链 = typed omission 不入列）。
- 结果：**通过（含真实残留记录）**。
- **走查发现 F-3（迁移遗留缺口，建议后续批次立项）**：宿主对 ccski 3.0 管辖
  技能**没有内核感知的卸载面**——内核 `removeEntityProjections`/`deleteEntity`
  在宿主 src 零引用；产品唯一删除面 = Creator 的 revision-checked
  `rmSync(skill.path)`。对 symlink face 它先被 containment 拒绝（canonical 实体
  路径在 provider root 之外 → creator.load 报 Internal server error，实测）；走
  entity face（amp）删除则物理删实体、留下悬空投影链与 stale state 记录（本次
  W8 实况）。需要「投影先行 remove + 实体 GC」的产品面（Repository/Uninstall）。

## 全局断言

- console 零新增错误：走查全程 `agent-browser console` 过滤后 0 error（仅
  tailwind/sveltekit 开发噪音，见过滤清单）。
- 断线/草稿保护（现有代次门）：未在走查中破坏性模拟断线；以全量测试中的
  request-generation / store 代次门用例（2393/2393 绿）为回归收据。
- 44px 触达/窄屏法则：本次 webui 改动仅 detail 面板 title/aria 与只读路径行，
  未新增可交互目标；chips 触达地障（chips-row ::after 外扩）未触碰。
