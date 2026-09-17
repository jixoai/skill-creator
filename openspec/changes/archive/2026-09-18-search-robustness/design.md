# Design: search robustness

## 上下文

既有事实（见 `openspec/specs/skill-search/spec.md` 与 `docs/search-design.md`）：
canonical 去重、冻结分词器、BM25+冻结 rerank、五版本信封 + payloadDigest、
stat 四元组增量、TOCTOU fd 身份校验。本设计在其上扩展内容范围、配置、监听与
平台实证，不回退任何已冻结契约。

## D1 内容范围（R1）

```text
skill 目录
  ├── SKILL.md / .SKILL.md -------- 身份源（不变：frontmatter + headings + body 12k）
  └── 其余 *.md ------------------- 正文补充（collectExtraMarkdown）
        递归真实目录，深度 ≤4（skill 目录自身为 0）
        dot 目录不进；排除目录（D2 清单）不进；symlink 目录/文件不进
        每文件 fence 剥离 + 文本 cap 6k；合计 cap 12k；文件数 cap 32
        路径排序确定性（不依赖 readdir 顺序）
body = skillBody（12k cap 不变） + "\n" + extraJoin（合计 12k cap）
```

- dot 规则只作用于**目录**（复审 R1 修正）：`.notes.md` 等合法 dot md 进入正文；
  文件级排除仅身份源变体（skill.md/.SKILL.md 大小写不敏感）。
- 文档级额外 md 与 SKILL.md 同源安全级别：`lstat` regular file 才读；fd 读取
  仍走 `O_NOFOLLOW`（win32 为 0）+ `fstat` 身份（ino+size）。目录递归前 lstat
  复核真实目录（收窄 readdir→递归 的 symlink 替换 TOCTOU 窗口；与 scanner
  同族的残余窗口为本设计声明的威胁模型边界，不承诺无 race 的目录 fd 行走）。
- `contentHash = sha256(SKILL.md bytes ‖ 每个额外文件 bytes（额外文件路径序）)`——
  保持「实际被索引文件字节」语义；额外文件增删改全部改变 hash。
- 两个已冻结序列（复审 R2 修正）：hash 拼接序 = source-first；stat 快照
  `files` = 全路径升序（读取按 sourcePath 定位身份源，不假设首位）。
- `PARSER_VERSION` → `matter-mdset-v2`；任何抽提/cap 规则再变更必须递增。

## D2 stat 形状与信封 v3

```text
stats[id] = {
  canonicalPath, installations, contentHash, disabled, conflict,
  invalidFrontmatter,
  files: [{ path, mtimeMs, size, ino, ctimeMs }]   // path 绝对、排序；含身份源 + 额外 md
}
```

- freshen 增量判定：`files` 集合（路径相等）且逐文件四元组相等 → unchanged；
  任何增删/四元组漂移 → changed（重读该 skill 全部文件）。
- `schemaVersion: 3`；v2 缓存 safeParse 失败 → 一次性全量重建（无迁移）。
- envelope 增 `configDigest`（见 D3）；load 时与当前配置摘要不等 → corrupt 重建。

## D3 排除配置（R2）

- 路径：`<appDir>/search-config.toml`（与 search-index.json 同目录，
  server-owned）。daemon boot（domain 装配即 engine 构造）预写模板：编辑器
  入口在任何检索前都指向真实文件；构造期 IO 硬错误 warn 不阻止启动，
  maintain 中的同类错误按 typed 失败上抛（复审 R1 修正）。
- 内置默认排除（代码冻结）：dot 目录全跳（独立于配置，不可配置关闭）+
  `node_modules`, `build`, `dist`, `target`, `__pycache__`, `tmp`, `logs`。
- 配置模板（boot 缺失时原子写；写入带 TOML 注释说明语义与追加语义）：

```toml
# Skill search content configuration (server-owned).
# excludeDirs 中的目录名不会进入技能正文索引（内置清单之上追加，
# 只能增加排除，不能移除内置排除与 dot 目录规则）。
excludeDirs = [
  ".cargo", ".cache", ".npm", ".pnpm-store", ".bun", ".rustup", ".local",
]
```

模板默认值即用户清单中未被内置 dot 规则覆盖的具名 dot 目录——显式写出
便于用户理解与追加；dot 全跳规则独立生效。

- 解析：读文本 → `smol-toml` parse（外部输入，`unknown`）→ Zod
  `SearchConfigSchema = { excludeDirs: string[] (min-1 条目，dedupe，排序) }`
  → 失败按领域空值 = 仅内置默认（safeParse 语义，不迁移不写回）；IO 硬错误
  （EACCES/EIO）按 hard error 处理（与 workspaces.json 同纪律）。
- `configDigest = sha256(排序去重后的排除名 join("\n"))`；进信封，变更即
  全量重建（排除变化改变文件集形状，增量不可靠）。

## D4 watcher（R3 之外的 R4）

```text
freshen 完成后：
  desired = 去重(realpath(root.rootPath)) ∩ 存在目录
  reconcile：新增 fs.watch(dir, {recursive:true, persistent:false})
             消失 → close
  watch 抛错/EMFILE/EPERM → root 标记 unwatched（本轮起回退逐搜索扫描）

事件（任意 root）→ dirty = true（去抖 300ms 合并）
  去抖到期：documentCount ≤ 20k → 同步 freshen（实时刷新）
            > 20k        → 保持 dirty（下次 search 时刷新）

search()：
  全部 root watched && !dirty → 跳过 scan/canonicalize/freshen（纯内存查询）
  否则 → 现行路径（scan → canonicalize → freshen → 查询）并清 dirty
```

- 取舍声明：同步 freshen 在事件循环内执行；≤20k 文档的 stat-walk + 增量
  freshen 实测量级 <100ms（1k 全量 build 319ms，增量远轻），停顿可接受；
  更大语料自动降级 lazy——大语料的后台分片刷新属于 >10k 文档 Tantivy 评估
  同期的工程，不在本 change 偷渡。
- clean 路径零 realpath（复审 R1 修正）：roots 集合以纯字符串键缓存，键变或
  dirty/config 变更才走 maintain；canonical watch dirs 只在 maintain 内解析。
- watch 经可注入 seam（`WatchFactory`）：单测用确定性假句柄（同步事件 + 假
  计时器），真实 fs.watch 保留一个宽松 deadline 的集成用例——FSEvents 投递
  时序不作单测依赖（复审实测三项时序抖动）。
- `persistent:false` + `dispose()` 显式 close 全部句柄；dispose 接入
  `daemon/index.ts` stop coordinator（`settleTeardown("skill search", …)`），
  不阻塞进程退出。
- Node 24 三平台均支持 recursive watch（Linux inotify 自 20.13）；失败回退
  已定义。realpath 后去重避免 19 provider 共享目录的重复 watch。
- watcher 不做权限/内容判断——它只让「跳过扫描」变得安全；安全语义仍由
  freshen 的 fd 身份校验持有。

## D5 编辑器入口（R3）

- RPC：`skills.searchConfig.open`，无输入，输出 `{opened: true}`；daemon
  spawn 平台 opener（macOS `open <path>` / win32 `explorer <path>`（回退
  `cmd /c start "" <path>`）/ Linux `xdg-open <path>`），路径为 server-owned
  常量派生，不收调用方输入。authority：readonly（无数据 mutation；OS 副作用
  与 openinbrowser 同级）。
- UI：命令面板 Navigate 组新增「Open search config」；ProviderView 过滤栏
  加图标按钮（tooltip 同文案）。

## D6 Windows 实证（R5）

- 流程：`ssh gaubeehonor` → 环境探测（node/pnpm/git）→ clone →
  `pnpm install` → `vp test run test/skill-search-*.test.ts test/rpc-search.test.ts`
  → `node dist/cli.js search` smoke（预 build 或 tsx 直跑）。
- 预期风险与预案：`st_ino`（Windows NTFS file id；若恒 0 则身份校验退化为
  size+mtime——需在 stat 形状里补 mtimeMs 参与比对，本来就是四元组成员）、
  路径大小写与分隔符（canonicalPath 进 id 摘要，大小写差异会分裂 id——若
  实测复现则 id 摘要前做小写归一——**仅在实测证实后做**）、rename 覆盖语义、
  recursive watch 可用性。
- 产出：实测记录（命令 + 输出摘要）进 tasks 证据；发现即修，修复必须带
  Windows 上复跑的聚焦测试证据。

## D7 小包（R6）

- `SEARCH_DEBOUNCE_MS` 从 skills store 导出，三消费方引用同一常量。
- palette 行 scope 字段类型：`WorkspaceId` / `ProviderId`（shared 类型再导出）。
- 检索失败：store catch 分支 `console.debug("[skill-search]", …)`（不 toast，
  降级投影仍由消费方持有）。
- Esc/外点 dismiss：真实可见窗口 vision 走查复验（非遮挡窗口，可信事件）。
- 安装→可搜集成测试：Repository install 落盘后 `skills.search` 立即命中新
  技能（依赖 freshen 的 stat 增量；watcher 前后都成立——安装路径在
  provider root 内，freshen 会发现）。

## 测试与验证

- 单测：config 解析矩阵（缺省/合法/注释/畸形/追加语义/digest 稳定性）、
  额外 md 收集（排除目录/深度/数量 cap/symlink 拒绝/确定性排序）、stat 文件
  集增量（增删改/保时保长替换）、信封 v3 校验与 v2 废弃重建、watcher
  （事件→freshen、dirty-lazy 分支、unwatched 回退、dispose 无泄漏句柄）。
- 集成：RPC `searchConfig.open`（沙箱 opener stub）；安装→可搜链路。
- 平台：macOS（本地全量）+ Windows（D6 清单）。
- 走查：vision 子代理真实窗口复验 Esc/dismiss + 配置入口按钮 + 排除目录
  实际不进正文（沙箱 fixture：node_modules 下 md 不影响搜索与 hash）。
