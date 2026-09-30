# Proposal: self-skill symlink — 全局技能改为指向产品自带源的符号链接 + 冲突裁决面

## Why

用户原始需求 [2026-09-30]（self-skill-bootstrap 归档后的方向修正）：「~/.agents/skills/
skill-creator-v2 这个文件夹应该走 symlink。每次启动 skill-creator …不论 npm 源（npx/
全局安装）还是 git clone 源码启动，这个 skill 本身存在于我们的 git 仓库内，发布 npm
的时候会一起带上。所以安装的时候，将这个 skill 通过 symlink 存放到 ~/.agents/skills/
skill-creator-v2 中……如果发现已存在，需要检查它的来源……是不是 npm:skill-creator 或者
git:skill-creator，如果是就属于我们的源，可以安心管理；symlink 的 realpath 和这次启动
的源对不上就删掉重建。反之源头不是 git/npm，意味着用户自己在维护，只能在 cli 或
webui 启动之后提醒用户存在 skill 冲突，给几个选择：覆盖安装我们自己的版本（可选备份
原版到 ~/.agents/skills-backup/skill-creator-v2-YYYY-MM-DD-hh-mm-ss）；坚持使用用户
自己已有的版本。」

v1（self-skill-bootstrap）拷贝式自举的固有缺陷：文档有双源（包内常量 vs 落盘副本），
产品升级后副本过期需要版本协商。symlink 模型让产品安装内的 `skills/skill-creator-v2/`
成为唯一事实源：文档随包升级自动保鲜、无版本迁移、来源可鉴定（realpath 落在哪个
skill-creator 安装里）。

## What Changes

```text
产品安装（npm 或 git）
  <pkgroot>/skills/skill-creator-v2/{SKILL.md, references/tools.md}   ← 唯一事实源（入仓+随包发布）
        ^
        | symlink（win32 用 junction）
~/.agents/skills/skill-creator-v2

每次 daemon 生产启动 ensure：
  link 缺失 ----------------------> 创建 symlink → linked
  link → 本源 --------------------> current
  link → 其它 skill-creator 安装 --> 删链重建（relink）
  link 悬空（目标安装被清理）-----> 删链重建（无用户内容可失）
  真目录 + 我们 v1 的管理标记 ----> 迁移：换为 symlink（legacy copy）
  真目录（用户自维护）/链至外部 --> 冲突：不触碰，提醒 + 用户裁决
       ├─ 覆盖安装（可选备份 → ~/.agents/skills-backup/skill-creator-v2-<ts>）
       └─ 保留用户版（记住决定；冲突目标变化后才会再次提醒）
```

- **发现面增补**：ccski 2.5.0 的 root 扫描跳过 symlink 条目（`entry.isDirectory()`
  对 symlink 恒 false，实测钉死）。产品自身的两个 ccski 调用点（skill-service 发现面、
  workspace-registry 计数面）追加「symlink 条目增补」：对 root 下 symlink 条目经
  ccski `parseSkillFile` 重建同形 `{location:"user", sourceKind:"custom",
sourcePriority:500}` 条目（实测捕获的 customDir 形状）。这同时修复了用户手工
  symlink 技能在 GUI 隐身的既有缺口。
- **CLI**：新增 `skill-creator self-skill`（status / install [--backup] / keep）；
  `start` 就绪后若存在未裁决冲突——TTY 交互三选（覆盖+备份/覆盖/保留），非 TTY 打印
  提示与命令。
- **WebUI**：Workspaces 首页冲突 banner（覆盖[含备份勾选]/保留两个动作），经新增
  `selfSkill.state/resolve/keep` RPC；Dock 冷启动向量无 TTY，提醒必须由 WebUI 承载。
- **keep 决定持久化**：appDir 下 server-owned 记录（fingerprint = 冲突目标 realpath +
  SKILL.md 内容摘要）；同指纹静默，指纹变化重新提醒。

## Impact

- **改造现有能力**（v1 self-skill-bootstrap 的落盘拷贝语义整体退役，含 legacy 迁移）；
  产品提示词指针（skills_search → skills_info）不变，仅措辞从「installs」改「links」。
- **安全不变量不变**：冲突态永不自动覆盖用户内容；备份/覆盖只在用户显式动作后发生；
  symlink 目标必经 package.json 身份鉴定（name === skill-creator）。
- **打包**：package.json `files` 增加 `skills`；`npm pack` 必须含技能目录。
- 受影响面：`skills/`（新）、`src/daemon/self-skill.ts`（重写）、ccski 增补模块（新）、
  `skill-service.ts` / `workspace-registry/index.ts`（默认扫描器换增补版）、`src/cli/cli.ts`、
  `src/shared/rpc-contract.ts` + 新契约文件、daemon 路由、WebUI workspaces 首页、
  测试与 AGENTS/i18n。
