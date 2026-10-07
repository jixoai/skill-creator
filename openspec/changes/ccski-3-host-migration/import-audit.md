# ccski 3.0 迁移 · 全仓 import 面审计（批 1）

> 基线：ccski `file:../ccski` = 3.0.0（pnpm file: 为快照拷贝，dist 与兄弟仓逐位一致，
> sha256 复核通过）。审计方法：`rg -n 'from "ccski"'`（src/test/scripts/packages，
> 排除 node_modules/dist/webui）+ 退役符号全文检索（installSkills/removeSkills/
> toggleSkills/updateSkills/getSkillInfo/readSkillContent/searchSkills）。
> webui/ 零 ccski import（浏览器安全面不直接依赖内核，经 shared 契约消费）。

## 一、对齐面（保留面，不动）

| 位置                                           | 导入符号                                                                 | 3.0 兼容性                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| src/daemon/skill-service.ts:23                 | `validateSkill`、`type ListOptions`、`type ValidateOptions`              | 保留面原样；发现结果经 `CcskiSkillMetadataSchema` Zod 收窄，3.0 新增的 canonicalPath/entryKind/ownership/mode 等字段被 z.object 默认剥离，不破坏现有投影（批 2.3 增量消费 entryKind/ownership）        |
| src/daemon/ccski-symlink-entries.ts:20         | `listSkills`、`parseSkillFile`、`type ListOptions`、`type SkillMetadata` | 保留面。wrapper 本身批 3 退役；3.0 listSkills 已一等返回顶层 symlink 条目（path=链接路径，实测 discovery.ts:460 `accumulator.set(linkPath, …)`），wrapper 的按条目名去重使增补自然变 no-op，无双计风险 |
| src/daemon/workspace-registry/index.ts:17      | `type ListOptions`                                                       | 仅类型；providerScope options 形状（customDirs/customProvider/scanDefaultDirs/all）在 3.0 RegistryInput 全部保留                                                                                       |
| src/daemon/workspace-registry/projection.ts:17 | `type ListOptions`                                                       | 仅类型，同上                                                                                                                                                                                           |
| test/self-skill.test.ts:23                     | `parseSkillFile`                                                         | 保留面                                                                                                                                                                                                 |
| test/workspace-registry.test.ts:18             | `type ListOptions`                                                       | 仅类型                                                                                                                                                                                                 |
| test/ccski-symlink-entries.test.ts             | 经 wrapper 间接                                                          | 批 3 一并处理                                                                                                                                                                                          |

`.content` 消费核查：宿主不消费 `getSkillInfo`（skill-service 的 `info()` 直接读文件并自算
revision），`readSkillContent`/`searchSkills`/`SkillInfoResult` 全仓零引用——3.0 的
「info 投影去 content」破坏面对宿主零命中。

## 二、mutation 面（批 2 迁移）

| 位置                                                                  | 旧符号                                      | 迁移目标                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| src/daemon/repository-service.ts:18                                   | `installSkills`（唯一 2.x mutation 调用点） | `ensureEntity + projectEntity` 两阶段（批 2.1）；`RepositoryInstaller` seam → `RepositoryKernel` seam（ensureEntity/projectEntity 注入） |
| src/daemon/skills-update-service.ts（经 repository.install 间接重装） | 无直接 import                               | apply 改直连 `updateEntity`（批 2.2；ENTITY_NOT_FOUND 回退 ensureEntity+projectEntity）；hash 换 `computeSkillFolderHash` 单源 import    |
| src/daemon/skill-service.ts toggle（:293 文件改名启停）               | 无直接 import                               | ccski 管辖技能（发现层 ownership==="ccski"）改走 `toggleEntityProjection`（批 2.3）；新增 `entityToggle` 注入 seam                       |

## 三、退役符号残留

源代码：批 2 完成后应为 0。当前基线（批 1 时点）：

- src：`installSkills` × 1 文件（repository-service.ts:18 import + :91 类型引用 + :118 默认值）——批 2.1 工单本体。
- test：repository-service.test.ts / repository-lifecycle.test.ts 的 `installSkills` 假 installer 注入 × 8 处——随 seam 更名一并重写（批 2 测试）。
- 其余 15 个退役导出（removeSkills/toggleSkills/…九型）：全仓零引用。

## 四、构建/脚本面

- scripts/build-core.sh.ts：`BUNDLED_PACKAGES = {"ccski"}`（devDependencies → esbuild 打进
  bundle）——file: 协议不改变该行为（esbuild 从 node_modules 解析快照内容）。
- scripts/clean-install-check.sh.ts：断言安装树无 ccski 残留 import + license 清单读
  `../ccski/package.json`——file:../ccski 下路径不变，无需改动。
