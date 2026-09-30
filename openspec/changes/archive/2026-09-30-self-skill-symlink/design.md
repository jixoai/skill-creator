# Design: self-skill symlink

## D1 源定位与来源鉴定（package.json 身份 = npm/git 统一判据）

```text
resolveSelfSkillSource()（按 import.meta.url 自定位；测试可显式注入 anchor）
  walk up ≤8 层找 package.json 且 name === "skill-creator"
  → <pkgroot>/skills/skill-creator-v2 必须存在（不存在 → typed failed: source-not-found）
  viaGit = <pkgroot>/.git 存在（git clone/开发仓；否则 npm 安装树）——仅用于状态报告文案

provenanceOf(realpath)（鉴定任意既有目标是否「我们的源」）
  walk up ≤4 层找 package.json 且 name === "skill-creator" → ours
  （npm 源与 git 源在此判据下天然统一：两者都有同名 package.json——
    用户口中的 npm:skill-creator / git:skill-creator 是同一身份的两种安装形态）
```

bundle 事实：esbuild 会把模块的 `import.meta.url` 重写为 bundle 文件 URL——
dist/daemon.js 与 dist/cli.js 所在的 dist/ 上溯一层即包根；源码态从 src/daemon/
上溯两层即仓根。无需外部传参。

## D2 ensure 状态机（每次启动执行；永不抛出）

```text
lstat ~/.agents/skills/skill-creator-v2        [root 隔离阀 SKILL_CREATOR_SELF_SKILL_ROOT 不变]
  |
  +-- ENOENT ----------------------> mkdir -p root → symlink 创建 → linked
  |
  +-- 符号链接
  |     +-- realpath === 本源 ------> current（禁用痕迹在链接内部文件层，天然保留）
  |     +-- realpath 解析成功 且 provenance ours（其它安装）--> 删链重建 → relinked
  |     +-- 悬空（目标安装已被 npm 清理）--> 删链重建（无用户内容可失）→ relinked
  |     `-- provenance 非 ours -------> 冲突 foreign-link（目标绝不触碰）
  |
  +-- 真目录
  |     +-- frontmatter 带 x-managed-by: skill-creator 且文档字节 === 本次源
  |     |     → legacy 拷贝迁移：目录整个移除换 symlink（无备份——字节级产品产物）→ migrated
  |     +-- 带 marker 但内容有偏离 ----> 冲突 user-directory（marker 可被仿冒，
  |     |                                 偏离的一律走显式裁决——复核 P2 加固）
  |     `-- 其它 -----------------------> 冲突 user-directory（可备份对象）
  |
  +-- 冲突 × keep 记录指纹匹配 ------> kept（静默；指纹变化重新提醒）
  `-- IO 硬错误 ---------------------> typed failed，log，启动继续

symlink 创建：posix 用 'dir'；win32 用 'junction'（目录联接无需管理员权限，绝对目标）。
禁用语义（复核 P1-3 裁决）：toggle 的 rename 会穿透 symlink 改写 server-owned root
之外的目标（安装内技能源/用户自有目录）——skill-service 对「顶层链接条目 realpath
覆盖域」内的技能 toggle 一律返回 typed conflict；链接条目的启停由链本身管理。
（旧稿「禁用态活在链接内部文件名层」的断言错误，按实现纠正。）
```

## D3 冲突裁决（用户显式动作，双面同源）

```text
resolveSelfSkillConflict({backup})
  user-directory:  backup? move 目录 → ~/.agents/skills-backup/skill-creator-v2-YYYY-MM-DD-HH-mm-ss
                          （本地时间；rename 同卷原子；失败 → typed failed，不动原目录）
                   backup=false → 递归移除（用户明确放弃；unlink 对目录恒 EPERM——复核 P1-2）
                   然后 symlink 创建 → linked
  foreign-link / foreign-entry: 仅移除条目本身（unlink；用户内容在别处/链目标，不触碰）

keepSelfSkillUserVersion()
  fingerprint = {kind, realpath, contentDigest(sha256 SKILL.md bytes)}
  持久化 appDir()/self-skill-keep.json（strict Zod；原子写；safeParse 失败按无记录=重新提醒）

消费面：
  CLI `skill-creator self-skill status|install [--backup]|keep`
  CLI `start` 就绪后：冲突未裁决 → TTY readline 三选；非 TTY 打印提示 + 命令
  WebUI Workspaces 首页 banner（RPC selfSkill.state 实时计算 + resolve/keep 动作）
  —— Dock 冷启动向量 = cli.js start 无 TTY，WebUI 是该场景唯一可见提醒面
```

## D4 ccski symlink 发现增补（独立模块，两个调用点共用）

```text
listSkillsWithSymlinkedEntries(options)（包装 ccski listSkills）
  listed = ccski listSkills(options)
  for root of options.customDirs:
    readdir(root, withFileTypes)
    for entry where entry.isSymbolicLink():
      linkPath = root/entry.name
      realpath(linkPath) 已在 listed 的 realpath 集合 → 跳过（去重）
      SKILL.md / .SKILL.md（按 includeDisabled 语义）缺 → 跳过（非技能链）
      parseSkillFile(ccski) 失败 → 跳过（坏 frontmatter 不进发现面）
      → 追加 {…listed 同形, provider: customProvider, location:"user",
             sourceKind:"custom", sourcePriority:500, path: linkPath,
             disabled, hasReferences/Scripts/Assets, pluginInfo:null}
```

- 形状来源：实测 ccski customDir 条目（location "user" / sourceKind "custom" /
  sourcePriority 500），逐字段镜像，下游 `projectMetadata` 的 Zod 收窄兜底。
- 去重口径（复核 P2-2 对齐实现）：按「同 root 内同名真实目录已列出不重复补」；
  真目录 + 指向它的别名链会让 registry 计数面计 2（skill-service 面经 canonicalDirectory
  归并同 id 不受影响）——计数为观察值，接受；增补条目不参与 include/exclude 令牌过滤
  （产品调用点不使用）。
- 身份一致性：`canonicalDirectory` 在投影层自行 realpath，link path 与 real path
  归并到同一 canonical 技能 id，与 search 索引（scanner 本就跟进 symlink）对齐。
- 接线点：`skill-service` 默认 discoverSkills、`workspace-registry` 默认 listCcskiSkills；
  既有注入 seam 不变（测试桩不受影响）。

## D5 打包与测试隔离

- package.json `files` += "skills"；发布前 `npm pack --dry-run` 必须列出
  `skills/skill-creator-v2/SKILL.md` 与 `references/tools.md`。
- 隔离阀沿用 `SKILL_CREATOR_SELF_SKILL_ROOT`（引走 agents-skills 根）；源定位可在
  测试注入 anchor（fake 安装树 = tmp 下 package.json(name skill-creator) +
  skills/skill-creator-v2）；keep 记录随 appDir（SKILL_CREATOR_HOME/setHomeOverride）隔离。
- WebUI 走查（dev）：valve 指向沙箱根 + 沙箱内伪造 user-directory 冲突 → banner
  桌面 + 窄屏验证，不触碰真实 ~/.agents。
