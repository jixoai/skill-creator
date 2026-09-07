# skill-steward-contracts verification

记录日期：2026-09-06 起草，2026-09-07 持续更新。**终态：R13 复核通过（8.0/10）——`Skill Steward contracts ready`**（R13 报告 /tmp/stage1-contracts-review-round13.md，固定 af7453b；R8→R13 六轮闭环，评分轨迹 3.0→3.0→4.5→4.0→4.5→5.0→8.0）。契约版本 **1.5.0**。运行环境：本仓 dev 主分支，macOS arm64。

## 责任矩阵

| Task                                           | 实现提交 | 证据                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 审计证据纳入 + 无 DSH 依赖声明             | d18c148  | `src/shared/contracts/skill-steward.ts` 头注释引用官方 deepseek-harness d347e703 / 0.1.3-alpha.1 与 dsh-* seam 表，并声明本阶段零 DSH import（`rg -n "deepseek-ai" src/shared/contracts/skill-steward.ts` 可见引用仅在注释）                                                                                         |
| 1.2 snapshot/task/response/toolcall/patch 契约 | d18c148  | 同文件：`SkillStewardContextSnapshotSchema`（scope/身份/revision/有界内容/版本/能力，superRefine 预算与成员检查）、`SkillStewardTaskSchema`（check/optimize/organize）、`SkillStewardResponseSchema`（闭合 union）、`SkillToolCallSchema`（七工具 + principal 规则）、`SkillPatchSchema`（edit/disable/split/merge） |
| 1.3 闭合 union 与拒绝语义                      | d18c148  | patch/finding/`SkillValidationResultSchema`/`StewardApprovalGrantSchema`/`StewardAuditRecordSchema`；`bindProposalToSnapshot` 输出类型化失败（SNAPSHOT_MISMATCH/UNKNOWN_SKILL/STALE_REVISION/UNSUPPORTED_WRITE_SCOPE/CONTRACT_VERSION）                                                                              |
| 1.4 版本化 prompt 与模板                       | c2871c3  | `src/daemon/steward/prompts.ts`（STEWARD_PROMPT_VERSION/STEWARD_TOOL_VERSION 1.0.0，固定 allowlist/证据格式/审批边界/no-direct-write）+ `templates.ts`（三类任务 user turn + 快照摘要）                                                                                                                              |
| 1.5 fixtures 与 focused tests                  | e95f839  | `test/fixtures/steward/*.json` ×10 + `test/skill-steward-contracts.test.ts` 18 tests                                                                                                                                                                                                                                 |
| 1.6 全量门禁                                   | 本文件   | 见下方命令记录                                                                                                                                                                                                                                                                                                       |
| 1.7 每种 action 正反 fixture                   | e95f839  | edit(disable-mismatch)/disable(missing-evidence)/split(traversal)/merge(traversal traversal)；负例单变量变更，frontmatter/body 完整保留                                                                                                                                                                              |

## 门禁记录（串行执行，2026-09-06）

```text
（R2 整改后，2026-09-06，边界 df75447）
pnpm exec vitest run test/skill-steward-contracts.test.ts -> 34/34 passed（含 8 项 R2 复核探针负例）
pnpm exec vitest run test/skill-steward-runtime.test.ts   -> 34/34 passed（含 2 项 apply 期映射源身份正/负例）
pnpm test / typecheck / webui check / build / fmt / diff-check / openspec validate
  -> 见 R2 整改提交后的完整串行门禁（本文件「R2 整改」节）；上一轮 271/271 记录已被 334+/334+ 取代。

（R1 整改轮记录，2026-09-06，边界 5727598）
pnpm test -> 310/310 passed（41 files）；contracts 25/25；runtime 32/32；typecheck 0 错误。
（最初记录 271/271 仅属 5ff7d8f 边界，已过期。）
```

## 前置修复（GOAL Observe 要求的 2 项 timeout）

- 根因：每个测试用 daemon domain 首次 `skills.list` 触发真实 `npx skills list --json` 子进程（15s 超时、可访问网络）；高负载下单用例超过 vitest 20s 用例超时（reviewer 复现 417s / 2 timeouts）。
- 修复：`createDaemonDomain` 支持注入 `skillsCliProbe`；六个测试文件改用 `test/helpers/deterministic-probe.ts`（零子进程、零网络）。提交 9aca0fc。
- 结果：`pnpm exec vitest run test/agent-steward.test.ts` 16 tests ~4s（原 ~120s 本机 / 417s 负载）；全量 253→271 全绿。未提高任何 timeout，未删除测试。

## Codex 复核闭环

- R1（4.5/10，不通过）：P1-1 路径校验 / P1-2 observed≠expected / P1-3 重复身份 / P1-4 伪造 byteSize → 全部修复（1.2.0，5727598）。
- R2（5.5/10，不通过，报告 /tmp/stage1-contracts-review-round2.md）：
  - P1-1 快照资源 relPath 绕过共享校验 → 修复：`StewardResourceEntrySchema.relPath` 改用 `RelPathSchema`（df75447）。
  - P1-2 sourceSkillId 未绑定且 apply 用 primarySourceId 错源 → 修复：parse 按 kind 闭合、bind 对齐 manifest、apply 逐映射解析源并复核存在性+sha256（df75447）。
  - P1-3 Global 接受 enable → 修复：agent bind 全域拒绝 enable、Global 仅 disable；Manager 反向走 `bindManagerDerivedProposalToSnapshot`（df75447）。
  - P2-1 evidence 范围 / P2-2 target 碰撞 / P2-4 模板渲染不强制 bind → 一并修复（df75447）。
  - P2-6 verification 过期 → 本文件即整改。
  - R2 task 表补充说明：enable 正反例以程序化 fixture 存在于 P1-3 探针测试（agent 拒绝 / manager binder 接受），不属 Agent fixture 文件集合——enable 按 1.1.0 设计即 Manager 派生专用。
- R3（6.5/10，不通过，报告 /tmp/stage1-contracts-review-round3.md；独立工作树 53bd73c）：
  - P1-1 observedRevisions 允许额外身份 → 修复：proposal superRefine 要求观察身份 ⊆ skillIds（与既有 exact 覆盖检查合成精确相等），1.4.0。
  - P1-2 同 target 重复 targetPath 静默覆盖 → 修复：`StewardPatchTargetDocumentSchema` 解析层拒绝 duplicate targetPath；apply 增加 seen-target 防御（手工构造/重放绕过解析时 typed 失败 + 补偿零残留）。
  - P2-1 finding evidence 身份未闭合 → 修复：finding superRefine 要求 evidence.skillId ∈ finding.skillIds。
  - P2-2 symlink/type/size 语义（原判 runtime-stage 延期）→ 提前关闭：apply 前 `lstat` 严格 regular file + manifest `kind:"file"` + `byteSize` 活体比对；负例（symlink 同字节换体）进 runtime 测试。
  - P2-3 Manager binder authority 依赖调用纪律 → 维持延期（capability 化归 steward-product-workflow；产品调用链 managerDerived 标记正确）。
  - P2-4 per-tool typing / P2-5 grant/audit/journal 形状 → 维持原 Deferred owner（见下节）。
  - 两个 disable fixture 自带的 patch 外观察（R3 探针起点）已重排为精确集合。
  - 门禁（整改后）：contracts 38/38、runtime 36/36、全量 371/371（47 files）、typecheck 0、webui check 0/0、目标文件 fmt 绿、`git diff --check` 干净、openspec 9/9。
- R4（6.0/10，不通过，报告 /tmp/stage1-contracts-review-round4.md；独立 worktree c9b4ce1）：
  - P1-1 父目录 symlink 换体 → 修复：apply 源读取改为「canonical realpath 必须落在 canonical root 同一相对位置（任一 symlink 祖先即拒绝）+ O_NOFOLLOW 描述符打开 + fstat regular/byteSize + 从 fd 读字节」，目标侧 mkdir 后同样校验父链无 symlink（1.5.0）。
  - P1-2 targetPath 可覆盖主文档 SKILL.md → 修复：target schema 拒绝 basename 大小写不敏感等于 skill.md 的映射；apply 防御同规则断然失败（负例：parse 与手工构造直达 apply 双覆盖）。
  - P1-3 edit 伪造 frontmatter 身份 → 修复：bind 层新增 EDIT_IDENTITY_MISMATCH（edit.frontmatter.name 必须等于快照条目 directoryName）；apply edit 分支保留同规则防御（负例：bind typed 失败 + 合法 edit 通过）。
  - P2-1 快照身份唯一性 → 修复：snapshot superRefine 要求 directoryName（大小写归一）、name、manifest (skillId, relPath) 唯一（三个负例）。
  - P2-2 大小写文件系统判重 → 修复：契约与 apply 的 duplicate targetPath 检测均按 lowercase 归一（负例：仅大小写不同的两条映射 parse 拒绝；apply 防御负例进 P2-3 compensation 测试）。
  - P2-3 move 假实现 → 修复：move 为真实移动语义（写目标 + journal 记账 + 删除源），compensation 以捕获字节还原源（负例：冲突 move 轮 compensated 后源字节零丢失、目标零残留）。
  - P2-4 verification 过期 → 本文件即整改（边界更新为 1.5.0；全量门禁见下）。
  - 门禁（R4 整改后）：contracts 42/42、runtime 40/40、全量 387/387（50 files）、typecheck 0、webui check 0/0、目标文件 fmt 绿、`git diff --check` 干净、openspec 9/9。全树 `vp fmt --check` 仍有 6 个并行文件失败（3 个 archive/demo、contracts demo html、runtime fixture-transcript.json、本 verification.md）——属跨 change 工作树卫生，不作为本 change 门禁事实。
- R5（5.5/10，不通过，报告 /tmp/stage1-contracts-review-round5.md；独立 worktree 12d5d74）：
  - 判定：R4 的 P1-2/P1-3/P2-1/P2-2 经独立探针关闭；P1-1 未闭合（realpath 检查与字符串 IO 拼接，TOCTOU 探针可 applied）；P2-3 升级为 P1（move rollback 无持久备份，审计 rolled-back 但源字节丢失）。
  - P1-1 修复：源读取改为「canonical 一致 → lstat 捕获 {dev,ino} → O_NOFOLLOW fd 打开且 fstat 身份必须一致 → 从 fd 读 → 读后 canonical/inode 复核」（Node 无 openat 的平台等价 no-symlink traversal，身份链消除双重取值窗口）；目标写入 exclusive fd（O_CREAT|O_EXCL，symlink leaf 失败）+ 写后 canonical/inode 复核，检测到逃逸时清零外部文件并终态 recovery-required（绝不谎称干净补偿）；恢复侧（compensation/rollback 的源还原）同样走 canonical 校验 + exclusive 写；move 删除源前再次校验父链。
  - P1-2 修复：move 源字节先落 Manager-owned 持久备份（journal 旁 .backups/，write-ahead 记账携带 backupPath+sha256），同进程补偿、applyRollback 与重启 replay 共用；备份缺失/sha 漂移 → 抛错（recovery-required），不伪造已回滚。
  - 测试（R5 负例）：apply→prepareRollback→applyRollback 源字节恢复；undoJournalSteps 重启等价 replay 从持久备份恢复（断言 .backups/ 落盘 1 份）；12 轮并发换体 chaos——成功轮字节必为真实源、外部文件内容永不变化（swapper 在 realStore/outside 双 symlink 间高频切换，×3 稳定）。
  - P2-4 修复：本文件边界与门禁事实同步（1.5.0；全量 390/390）。
  - 门禁（R5 整改后）：contracts 42/42、runtime 43/43、全量 390/390（50 files，两次串行全绿）、typecheck 0、webui check 0/0、openspec 9/9。
- R6（4.0/10，不通过，报告 /tmp/stage1-contracts-review-round6.md；独立 worktree f2519cc）：
  - 判定：R5 源读取身份链与 chaos 关闭了"读到外部字节"窗口（独立复跑通过）；新三个 P1——检查后换体仍可删/清零外部文件（源 rm 与目标逃逸分支）、backup/journal 路径 authority 未封闭（backup 目录预置 symlink、journal 任意 backupPath、symlink leaf 同字节假恢复）、journal 缺失被空回放伪造 rolled-back。
  - P1-1 修复：目标逃逸分支**不再触碰外部路径**（去掉清零，仅 UNAVAILABLE/recovery-required，外部文件保持原状）；move 源删除改为身份绑定删除（父链校验 + lstat 身份捕获 → rm → 删除后存在性验证，任何漂移 recovery-required——Node 无 unlinkat 的平台等价语义）。
  - P1-2 修复：backup 根由 canonical journalPath 派生且每次使用前 canonical containment（预置 symlink 拒绝，备份 exclusive fd 写 + 目录 fsync）；journal 只记 Manager 生成的相对 backupRef（`\d+-[a-f0-9]{12}.bin` 白名单），replay 拒绝绝对/遍历路径并经 strict fd 读取校验；恢复对现存 leaf 强制 lstat regular（symlink 同字节≠恢复成功）。
  - P1-3 修复：readJournal 区分 ENOENT（NOT_FOUND）/不可读/坏行（UNAVAILABLE）——不再投影为空；applyRollback 将 readJournal 与空 journal 纳入 recovery 捕获，audit 如实 recovery-required，绝不 rolled-back。
  - P2-1 部分修复：backup 写后目录 fsync（syncDir，失败→UNAVAILABLE）；journal append 仍为普通 append（进程内单写者），崩溃栅栏完整化（fd append + fsync）归 runtime 收尾轮。
  - P2-2 修复：verification 顶部边界更新为 1.5.0/当前提交；fmt 失败计数以复核独立运行为准（R6 列 7 个跨 change 文件，本 change 目标文件不在其列）。
  - 测试（R6 负例 ×4）：journal 删除 → applyRollback recovery-required（非假 rolled-back）；journal backupRef 篡改为外部绝对路径 → replay 拒绝且源不被外部字节污染；backup 根预置 symlink → apply fail-closed 且外部目录零写入；源位置预置同字节 symlink → replay 拒绝（not a regular file）且外部文件不被触碰。
  - 门禁（R6 整改后）：contracts 42/42、runtime 47/47、全量 394/394（50 files）、typecheck 0、webui check 0/0、openspec 9/9。
- R7（3.0/10，不通过，报告 /tmp/stage1-contracts-review-round7.md；独立 worktree 90895f7）→ R8 整改：
  - 判定：R6 的逃逸不清零、静态 backup root 拒绝、空 journal 拒绝被确认；但独立探针复现 10 项新事实——源删除/目标写/backup 写的检查后换体（外部文件被真实删除/写入字节后才发现）、journal 删行/坏行/未知 step 仍可假 rolled-back、`fromRel`/`directoryName` 穿越 Provider 根（根外建文件、递归删根外目录）、backupRef 缺 hash 时同根任意字节可恢复进 Provider。
  - P1-1 修复（源删除）：`unlinkFileVerified`——lstat 捕获身份且 **nlink===1 独占 inode 策略**（hardlink 源直接拒绝）→ O_NOFOLLOW fd 打开且 fstat 命中捕获身份 → Linux 走 `/proc/self/fd/<已验证父目录fd>/` 锚定 unlink（unlinkat 等价）；macOS（/dev/fd 不支持子路径）复验父链后 unlink → 删除后 lstat ENOENT **且 fstat(fd).nlink===0**（证明删的是已验证 inode，而非"路径消失"）；任一不成立 → UNAVAILABLE/recovery-required。探针 10 的 hardlink 担忧由 nlink 策略一并关闭（负例测试）。
  - P1-2 修复（目标/备份/恢复写入）：`writeFileExclusiveVerified`——exclusive fd 打开后、**写任何字节之前**先锚定 realpath 位置 + lstat inode === fd inode（父目录/backup 根在检查与 open 之间换体时，最多在外部残留 0 字节占位，Manager 字节不越界落地）；写入走 fd + `handle.sync()`（**失败即 UNAVAILABLE，不再吞掉**——sync 失败阻断后续源删除）；写后再次复验位置与身份。
  - P1-3 修复（journal truth）：新 `src/daemon/steward/journal-schema.ts`——journal 行为闭合 Zod discriminated union（step/detail 逐字面量、strictObject 拒未知字段、move 必带 backupRef+sourceSha256、非 move 禁带备份事实）；`readJournal` 严格化（ENOENT→NOT_FOUND；不可读/坏行/未知 step→UNAVAILABLE；**seq 必须 1..N 连续**，删行/重排即拒）；apply 成功后追加 **commit 终态行**（proposalId 绑定）；`applyRollback` 经 `assertCommittedJournal` 回放闸——无 commit 行（崩溃/截断/删行）或 proposalId 不符 → recovery-required，绝不 rolled-back；`undoStep` 的 default 静默返回被闭合 union 消灭。
  - P1-4 修复（路径穿越）：journal 的 `from`/`to` 复用共享 `RelPathSchema`、`directoryName` 复用 `SkillDirectoryNameSchema`（解析层即死）；`undoJournalSteps` 入口对每条 entry 再过 schema（直调篡改也在文件系统操作前拒绝）；undo 删除目录绑定 **本 proposal 创建的目标集合**（`createdDirectoriesOf`——journal 任意指定目录/穿越递归删除被拒）+ lstat directory + canonical 一致 + 删后 ENOENT。
  - P1-5 修复（backup 完整性绑定）：`<backupRoot>/manifest.jsonl` Manager 生成并持久化（ref/seq/from/sha256/byteSize），备份写入顺序 = 字节落盘+fsync → 目录 fsync → manifest 行+fsync → journal 记账；回放按 manifest 精确匹配（缺行/坏行/重复 ref/seq-from-sha 不符/字节 hash 不符一律 recovery），journal 缺 sourceSha256 在解析层即拒。
  - P2-1 修复（持久化栅栏）：journal 从按路径 `appendFile` 改为**常驻 0600 append fd + 逐行 fsync**（打开失败留在 try 内走补偿路径，输出 typed 终态不裸抛）。
  - P2-2 修复：全树 `vp fmt` 归一（7 个跨 change 文件已格式化并单独提交；dsh-webui verification 中被 formatter 吞掉的 `__DSH_BOOT__`/`/ws/acp/*` 字面量以 code span 修复）；本文件边界更新为本提交。
  - 模块拆分：mutation 权威原语（fd 锚定读/写/删 + backup manifest）→ 新 `src/daemon/steward/fs-authority.ts`；journal 事实形状与严格读取 → 新 `src/daemon/steward/journal-schema.ts`；`apply-transaction.ts` 回归纯编排（文件意图法）。
  - 测试（R8 负例 ×8）：readJournal 对缺失/不可读/坏行/未知 step/删行（seq 断裂）全部 typed 拒绝；move 行缺 sourceSha256 解析层拒绝；剥离 commit 行 → applyRollback recovery-required（非假 rolled-back）；commit 行绑定他人 proposalId → recovery-required；`from` 穿越/`directoryName` 穿越/合法名但非本 proposal 创建 → 回放拒绝且根外 sentinel 文件完好；备份字节篡改（同长度）/manifest 缺失/坏行/重复 → 回放拒绝且源不被伪造恢复；hardlink 源 → nlink 策略拒绝 + compensated（源与外部 link 完好、目标零残留）；journal 0600 + 终态 commit 行落盘断言。
  - 已知残余（诚实声明）：macOS 无 fd 相对删除/创建，竞态残余为「外部最多出现一个 0 字节占位文件（写入前锚定即止损）」或「误删外部文件后立即以 nlink 证明转为 typed recovery-required（事实入 journal/审计）」；平台级原子化需 unlinkat/openat，Node 不暴露。Linux 已由 /proc/self/fd 锚定达成。journal 文件的 append fd 逐行 fsync 后仍无跨文件崩溃顺序证明（backup→journal 的持久顺序由先 backup 后 journal 的写入顺序 + 各自 fsync 保证）。
  - 门禁（R8 整改后）：contracts 42/42、runtime 55/55、全量见下轮记录、typecheck 0、webui check 0/0、openspec 9/9、全树 `vp fmt --check` 绿。
- R8（3.0/10，不通过，报告 /tmp/stage1-contracts-review-round8.md；独立 worktree ac686f7）→ R9 整改：
  - 判定：R8 在 ac686f7 复审，其 P1-1/P1-2/P1-4 的主体（journal/manifest leaf O_NOFOLLOW、双 commit 拒绝、manifest 双射）已由 432445f 预先关闭但未计入本轮评审；R9 在其之上继续关闭剩余缺口。
  - P1-1 journal 独占创建：journal writer 改 `O_CREAT|O_EXCL|O_NOFOLLOW`——崩溃残留/重复 apply/预置 symlink 一律 EEXIST/ELOOP fail-closed（恢复闸门拥有残留文件唯一处置权；负例：复用 journal 路径 → 非 applied 且残留字节原样单行）。
  - P1-2 manifest 读写 authority：写入端 post-open fstat 强制 regular file；读取端改 O_NOFOLLOW fd + fstat regular + fd 读（symlink/非常规 leaf 即便同根也拒绝）。
  - P1-3 root canonical：`assertRealRoot` 升级——lstat 真实目录且 `realpath(root) === root`（唯一豁免 darwin /var ↔ /private/var 系统 alias）；写/读/删/restore/目录删除入口全量接入（负例：回放 root 为 symlink → 拒绝且外部 sentinel 目录完好，递归删除从未执行）。
  - P1-4 终态计数闸：`assertCommittedJournal` 要求 commit 的 mutationCount === 磁盘 mutation 步骤数（edit/disable/enable/create-target/resource）——删除任一 mutation 行后整体重编号（seq 仍连续、manifest 无关）在终态即被拒。
  - P1-5 replay 身份绑定：undoStep 的 edit/disable/enable 步骤要求 skillId ∈ `affectedSkillIdsOfPatch(proposal.patch)`（回放数据不能启停 proposal 未触碰的技能；负例：disable 行换成同 snapshot 的非 proposal 技能 → affected set 拒绝）。
  - P1-6 删除改隔离改名（全平台统一）：`unlinkFileVerified` 不再 `fs.rm`——nlink===1 + fd 身份捕获后，rename 到 Manager backup root 内不可预测名 `removed-<rand>-<name>`；源从原路径消失即达成 move 语义。竞态残余的最坏结果从「外部字节被删除」变为「外部文件被移入 Manager 隔离区（字节保全、可审计、可人工恢复）」；跨卷 EXDEV fail-closed recovery；post 证明 = 原路径 ENOENT + 墓碑 inode === 捕获身份 + fd nlink===1（负例：成功 move 后墓碑唯一且字节等于源、manifest 记账不受墓碑影响）。
  - P1-7 restore 现存 leaf：O_NOFOLLOW fd 打开 + fstat 身份匹配 + fd 读取 + 读后 inode 复验（lstat→readFile 换体窗口关闭）。
  - Deferred（诚实声明）：per-line hash-chain/operationId 头（R8 P1-4 建议的更强形态）归 2.3e recovery gate 的 journal 头部改造；当前完整性由闭合 union + seq 连续 + mutationCount 终态闸 + manifest 双射 + affected-set 绑定组合承担。macOS 隔离改名的 rename 本身仍按路径执行——残余窗口内外部文件被移入（而非删除于）隔离区并立即转 recovery-required。
  - 门禁（R9 整改后）：contracts 42/42、runtime 59/59（新增 R9 负例 ×4）、probes 6/6、全量 415/415（52 files）、typecheck 0、webui check 0/0、fmt 全树绿、openspec 9/9。
- R9（4.5/10，不通过，报告 /tmp/stage1-contracts-review-round9.md；独立 worktree 315f27e）→ R10 整改（P1-5 判定关闭、P1-6 大体关闭，本轮关闭四个剩余 P1）：
  - P1-1 parent/root inode authority：`assertRealRoot` 返回 `{dev,ino}` 身份，`verifyDirIdentity` 在每次 leaf IO 前后复验（write/read/unlink/restore/backup 全链）——同 lexical 路径目录换体在操作内检出；journal 目录与 backup 父目录创建/使用前经 `assertCanonicalDirectory`（预置 symlink 父目录在写任何字节前拒绝）；manifest 打开后 `nlink===1` 独占 inode 门（hardlink 到外部文件的 manifest 打开即拒），写后复验 nlink（中途被 link 出去同样拒绝）。
  - P1-2 restore root 漏接：`restoreResourceBytesStrict` 首行 `assertRealRoot`（symlink root 下现存 leaf 读取防线不再建立在不可信 root 上）+ 读后身份复验。
  - P1-3 终态闸与 proposal 双射：`expectedJournalStepsOf(proposal)` 从 patch 展开 {kind 计数, create-target 目录名集, mutation skillIds 集}；`assertCommittedJournal` 要求磁盘 journal 与之精确双射——删行后同步伪造 mutationCount（R9 探针 5 形态）被独立锚（proposal，rollback 前 grant fingerprint 已复核）拒绝；`undoJournalSteps` 直调同样过终态闸。负例：真实 disable apply → 删 disable 行 + 重编号 + 伪造计数 → applyRollback recovery-required。
  - P1-4 journal 读取 authority：`readJournal` 改 O_NOFOLLOW fd + fstat regular + fd 读 + 读后 leaf inode 复验——预置 symlink journal（外部可控 JSONL）作为事实源被拒。
  - Deferred（诚实声明）：调用前（capture 之前）的同路径目录换体无法用操作内身份检测——换体目录占据的是 Manager-owned lexical 路径，字节仍落 Manager 路径空间；跨操作持久 inode 锚（store 目录 boot-time 绑定）归 2.3e recovery gate。R9 P2 的 manifest strict Zod schema 仍未做（手工 parser 的 ref/seq/from/hash 绑定仍在）。
  - 门禁（R10 整改后）：contracts 42/42、runtime 60/60（新增 forged-count 负例）、probes 12/12（新增 ×6：journal 父 symlink/backup 父 symlink/manifest hardlink/journal 读 symlink/restore symlink root/目录身份换体）、全量 422/422（52 files）、typecheck 0、webui check 0/0、fmt 全树绿、openspec 9/9。
- R10（4.0/10，不通过，报告 /tmp/stage1-contracts-review-round10.md；独立 worktree 140628e）→ R11 整改（R9 P1-2/P1-5/P1-7 关闭，本轮关闭全部七个 P1）：
  - P1-1 写前身份复验：writeFileExclusiveVerified 在 `handle.writeFile` 之前 `verifyDirIdentity(root)`（同路径目录换体在 payload 落盘前拦截）；writeBackupWithManifest 在 manifest open 前复验 backup root 身份（跨写事务持有）。
  - P1-2 目标删除前内容校验 + 隔离改名：journal 新增 create-target `revision` 与 resource `sha256`（apply 时落盘字节事实）；回滚删除前 walk 目录——文件集合必须精确等于 journal 事实树（SKILL.md + 资源路径）且逐文件 sha256 一致（外部编辑/新增/缺失 → recovery-required，目录保全）；删除 = 整目录隔离改名进 Manager 墓碑 + inode 证明 + 目录 fsync（不再存在递归 rm 外部树窗口；EXDEV fail-closed）。
  - P1-3 toggle 后置条件 + 前态恢复：`toggleWithPostcondition` 只接受预期终态（disabled/enabled），skipped 按捕获前态处理，conflict/failed 立即 typed 失败；journal disable/enable 的 wasDisabled/wasEnabled 升级为必填；undo 只恢复捕获前态（apply 前 disabled 的技能回滚为 no-op）；no-op disable 的 prepareRollback 直接返回「无事可回滚」，不派生会改坏原状态的 reverse enable。
  - P1-4 journal 读取目录 authority：readJournal 先 `assertCanonicalDirectory(dirname)` + 读后父目录身份复验（parent symlink 下的外部 JSONL 不再是事实源）。
  - P1-5 原语自守 containment：read/write/restore/unlink 四原语入口 `assertPathInside(root, candidate)`（遗漏前置断言的未来调用方不再变成外部读写/删除入口）。
  - P1-6 隔离 fsync 不再吞：quarantine 目录 fsync 失败直接 UNAVAILABLE（未持久化 rename 不得推进 journal/commit）。
  - P1-7 resource 语义绑定：journal resource 行新增必填 `sha256`；终态闸 + 回滚删除共用该事实（与 proposal 双射 + manifest 双射叠加）。
  - 模块：`dir-identity.ts` 拆出 canonical/身份原语（journal-schema 与 fs-authority 共用，破循环依赖）。
  - 门禁（R11 整改后）：contracts 42/42、runtime 62/62（新增 no-op disable 回滚 + 外部编辑阻断删除负例）、probes 14/14（新增 journal 父目录读取 symlink + 原语越 root ×4）、全量 426/426（52 files）、typecheck 0、webui check 0/0、fmt 全树绿、openspec 9/9。
- R11（4.5/10，不通过，报告 /tmp/stage1-contracts-review-round11.md；独立 worktree c92cc31）→ R12 整改：
  - P1-1 open→复验→写 模式：fd 锚定 inode——open 前捕获身份、open 后复验、通过才写字节（writeFileExclusiveVerified 对 root+nested parent 双重复验；manifest fd 打开后追加前复验 backup root；journal writer open 后复验 journal 目录身份）。open 后的目录换体不再影响 fd 写入目标；open 边界换体在字节落盘前拦截。
  - P1-2 resource mapping 双射：`expectedJournalStepsOf(proposal, snapshot)` 展开每条 mapping 的 `from|to|strategy` 多重集合，终态闸精确比对——同集合内的路径交换/策略替换拒绝。
  - P1-3 selection 级 inverse + journal 事实闸：prepareRollback（disable）先 readJournal + assertCommittedJournal（含 snapshot 双射），坏 journal 直接 typed 失败（不再 catch-null 派生）；reverse 只包含真实 toggle 的 selection（no-op 技能不进 reverse、不改原状态）；journal 自报 no-op 与 snapshot 前态交叉核对（伪造 wasDisabled → CONFLICT）；undoStep 的 wasDisabled/wasEnabled 同样与 snapshot 前态核对。
  - P1-4 edit rollback 事实锚：reverse 前置闸——audit mutations 的 apply-time afterRevision 必须存在且与当前 live revision 精确一致；外部编辑 → CONFLICT（现状保全，不被 reverse 覆盖）。
  - P1-5 unlink 身份闭环：assertRealRoot 返回的 root 身份不再丢弃——rename 前/后复验（换体后的「外部源被隔离」不再是 accepted）。
  - Deferred（诚实声明）：跨调用/boot-time store inode anchor（pre-call 换体检测）仍归 recovery gate；Node 无 fd-relative rename 的残余窗口=外部文件被移入可审计隔离区并转 recovery。
  - 门禁（R12 整改后）：contracts 42/42、runtime 65/65（新增 mixed no-op/坏 journal/mapping 篡改负例）、probes 14/14、全量 429/429（52 files）、typecheck 0、webui check 0/0、fmt 全树绿、openspec 9/9。
- R12（5.0/10，不通过，报告 /tmp/stage1-contracts-review-round12.md；独立 worktree 0e9ed1e）→ R13 整改（R11 P1-1/3/4/5 判定关闭，两个剩余 P1 关闭）：
  - P1-1 双射接入真实回放：`assertCommittedJournal` 的 `snapshot` 升级为必填，内部统一 `expectedJournalStepsOf(proposal, snapshot)`；`applyRollback` 与 `undoJournalSteps` 两个真实入口都传入 snapshot——mapping 双射（from|to|strategy 多重集合）在真实回放路径生效。负例：真实 merge-copy apply → 篡改 resource `from` 为另一合法路径 → 真实 `applyRollback` → recovery-required（非 rolled-back），且篡改对象源文件零触碰；既有 merge copy/move 回滚正例随真实流持续通过。
  - P1-2 目标删除绑定 root 身份：`removeCreatedDirectory` 保存 `assertRealRoot` 返回身份，在 lstat/内容 walk 后、rename 前、rename 后逐点复验——同路径换体后的「替换树被隔离」是 recovery，不是成功。
  - 门禁（R13 整改后）：contracts 42/42、runtime 66/66（新增真实 apply→tamper→applyRollback 负例）、probes 14/14、全量 430/430（52 files）、typecheck 0、webui check 0/0、fmt 全树绿、openspec 9/9。
- R13（8.0/10，**通过**，报告 /tmp/stage1-contracts-review-round13.md；独立 worktree af7453b）：
  - 终判定：`skill-steward-contracts` 阶段 1 可标记 **Skill Steward contracts ready**。R12 两个 P1 在真实调用链闭合（mapping 双射贯通 applyRollback/undoJournalSteps——真实 apply→合法路径篡改→applyRollback=recovery-required 且源文件零触碰；目标 root 换体→root identity drift recovery）。独立复现全部串行门禁（42/42、66/66、14/14、430/430、typecheck 0、webui 0/0、build、fmt 463 files、openspec 9/9）。
  - 复核保留的 P2/deferred（后续 owner）：P2-1 无 O_NOFOLLOW 平台的 leaf fallback（能力探测 fail-closed 或双检 + Windows CI）；P2-2 macOS 无 fd-relative rename 的保全式 recovery 残余（tombstone 事实入 recovery audit）；P2-3 manifest strict Zod schema 化 + per-tool payload typing（dsh-runtime-integration owner）。不宣称 DSH/runtime/UI 完成。
- （历史）R13 复审送审记录。
- R12 复审已随本整改提交（复核回调为后台 codex-callback.sh 模式）。
- R11 复审已随本整改提交（复核回调为后台 codex-callback.sh 模式）。
- R10 复审已随本整改提交（复核回调为后台 codex-callback.sh 模式）。
- R9 复审已随本整改提交（复核回调为后台 codex-callback.sh 模式）。
- R8 复审进行中（复核者在主工作树留下 5 个对抗性探针，已全部回归化并整改）：
  - 探针整改补充提交：manifest leaf / journal leaf 追加改 O_NOFOLLOW（预置 symlink → ELOOP 失败，外部零字节落地）；`assertRealRoot`（root 末级组件 symlink 拒绝——realpath 恒等攻击面）；`assertCommittedJournal` 要求恰好一条 commit 终态行且为末行；新增 `assertJournalManifestBijection`（journal move 步骤 ↔ manifest 记录 ref+seq+from 双射——删除 resource 行后整体重编号的部分 journal 在回放前暴露），入口 `undoJournalSteps` 先 union 复验再双射校验。
  - 探针回归化：`test/r8-independent-probes.test.ts` 6 tests（manifest symlink 拒绝且外部文件原样 / symlink root 拒绝 / journal leaf symlink typed 终态零外部字节 / 重编号 journal 双射与 proposal 绑定拒绝 / manifest 多余备份双射拒绝 / 重复 commit 记录拒绝）。
  - 门禁：contracts 42/42、runtime 55/55、probes 6/6、全量 411/411（52 files）、typecheck 0、dsh-official-profile 单独复跑通过（全量下一次超时为负载抖动）。

## Deferred（owner 与完成边界）

- **per-tool payload typing（R1 P2-4 / R2 P2-3）**：`SkillToolCallSchema.input/result.value` 仍为 `z.unknown()`。Owner：`dsh-runtime-integration`（DSH 侧 defineTool 已按 ParameterSchemaSpec 逐工具声明输入；contract 层 per-tool discriminated input/result schema 必须在 DSH adapter 以「契约层解析」替代「桥接透传」前关闭——即 dsh-webui-composition 之前）。不升级为阶段 1 P1 的理由：有限域工具与 principal 边界已闭合，无 Manager 写入绕过（R2 复核结论一致）。
- **transaction 形状收紧（R2 P2-5）**：~~journal entry versioned union + recovery parser schema 化~~（R8 已关闭：`journal-schema.ts` 闭合 union + commit 终态行 + manifest 绑定）；剩余 grant inputRevisions exact-set 与 audit 资源 source/hash/backup 字段。Owner：`skill-steward-runtime` 剩余任务（2.3e recovery gate / 2.4a）与 `steward-product-workflow`；在 rollback/recovery 面向用户开放前必须关闭。
- EOF 空行（R2 P2-6 提及的 audit-store.ts 文件尾）：已随 3.3 重构与 formatter 消除（`git diff --check` 于 df75447 边界干净）。

## 未验证项（诚实声明）

- 本 change 仅契约层：Agent runtime 接入、WebUI、daemon RPC 暴露属后续阶段（R2 复审时 dsh-runtime-integration 3.1-3.4 已并行推进，但不作为本 change 完成证据）。按 tasks.md Review gate，契约 ready 以复核通过为准（R8 待出）。
- `demo/contracts-reference.html` 未作为任何实现依据（`rg -rn "contracts-reference" src webui/src test` 零引用）。
