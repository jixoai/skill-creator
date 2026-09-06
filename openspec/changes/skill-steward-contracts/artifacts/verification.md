# skill-steward-contracts verification

记录日期：2026-09-06 起草，2026-09-07 持续更新。当前实现边界 `90895f7（R7 整改）→ R8 整改提交（本提交）`，契约版本 **1.5.0**（历史轮次边界见各节时标）。运行环境：本仓 dev 主分支，macOS arm64。

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
- R8 复审已随本整改提交（结论待出；复核回调为后台 codex-callback.sh 模式）。

## Deferred（owner 与完成边界）

- **per-tool payload typing（R1 P2-4 / R2 P2-3）**：`SkillToolCallSchema.input/result.value` 仍为 `z.unknown()`。Owner：`dsh-runtime-integration`（DSH 侧 defineTool 已按 ParameterSchemaSpec 逐工具声明输入；contract 层 per-tool discriminated input/result schema 必须在 DSH adapter 以「契约层解析」替代「桥接透传」前关闭——即 dsh-webui-composition 之前）。不升级为阶段 1 P1 的理由：有限域工具与 principal 边界已闭合，无 Manager 写入绕过（R2 复核结论一致）。
- **transaction 形状收紧（R2 P2-5）**：~~journal entry versioned union + recovery parser schema 化~~（R8 已关闭：`journal-schema.ts` 闭合 union + commit 终态行 + manifest 绑定）；剩余 grant inputRevisions exact-set 与 audit 资源 source/hash/backup 字段。Owner：`skill-steward-runtime` 剩余任务（2.3e recovery gate / 2.4a）与 `steward-product-workflow`；在 rollback/recovery 面向用户开放前必须关闭。
- EOF 空行（R2 P2-6 提及的 audit-store.ts 文件尾）：已随 3.3 重构与 formatter 消除（`git diff --check` 于 df75447 边界干净）。

## 未验证项（诚实声明）

- 本 change 仅契约层：Agent runtime 接入、WebUI、daemon RPC 暴露属后续阶段（R2 复审时 dsh-runtime-integration 3.1-3.4 已并行推进，但不作为本 change 完成证据）。按 tasks.md Review gate，契约 ready 以复核通过为准（R8 待出）。
- `demo/contracts-reference.html` 未作为任何实现依据（`rg -rn "contracts-reference" src webui/src test` 零引用）。
