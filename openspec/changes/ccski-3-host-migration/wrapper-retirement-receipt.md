# ccski-symlink-entries 退役收据（批 3.1 · 无漂移复跑对照表）

> 生成方式：scripts/ccski-wrapper-receipt.sh.ts（一次性，收据落盘后随 wrapper 一并退役），
> 同一 fixture 语料（真实目录 enabled/disabled + symlink enabled/disabled-only/非 skill
> 目标/坏 frontmatter/悬空链），customDirs 单 root、scanDefaultDirs:false，
> wrapper 在场（listSkillsWithSymlinkedEntries）vs 直连 ccski 3.0 listSkills。
> 字段口径 = 宿主消费面（provider 归属/sourcePriority/canonical path（= mutation
> target 与身份源）/directoryName/location/sourceKind/disabled）。

### 调用形状：all:true（宿主默认发现面）

| key（name\|canonicalPath\|disabled） | wrapper 在场                                                                                                      | 直连 ccski 3.0 | 字段漂移 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------- | -------- |
| `disabled-link                       | /private/var/folders/tn/y_b12zxs2dldn8thmfnpy9c80000gp/T/ccski-wrapper-receipt-PVHjCb/lib/disabled-link           | 1`             | 在       | 在  | 全等 |
| `linked-skill                        | /private/var/folders/tn/y_b12zxs2dldn8thmfnpy9c80000gp/T/ccski-wrapper-receipt-PVHjCb/lib/linked-skill            | 0`             | 在       | 在  | 全等 |
| `real-disabled                       | /private/var/folders/tn/y_b12zxs2dldn8thmfnpy9c80000gp/T/ccski-wrapper-receipt-PVHjCb/provider-root/real-disabled | 1`             | 在       | 在  | 全等 |
| `real-enabled                        | /private/var/folders/tn/y_b12zxs2dldn8thmfnpy9c80000gp/T/ccski-wrapper-receipt-PVHjCb/provider-root/real-enabled  | 0`             | 在       | 在  | 全等 |

- 行数：wrapper=4，直连=4；漂移行=0。

### 调用形状：all:false（仅 enabled）

| key（name\|canonicalPath\|disabled） | wrapper 在场                                                                                                     | 直连 ccski 3.0 | 字段漂移 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------- | -------- |
| `linked-skill                        | /private/var/folders/tn/y_b12zxs2dldn8thmfnpy9c80000gp/T/ccski-wrapper-receipt-PVHjCb/lib/linked-skill           | 0`             | 在       | 在  | 全等 |
| `real-enabled                        | /private/var/folders/tn/y_b12zxs2dldn8thmfnpy9c80000gp/T/ccski-wrapper-receipt-PVHjCb/provider-root/real-enabled | 0`             | 在       | 在  | 全等 |

- 行数：wrapper=2，直连=2；漂移行=0。

## 结论

漂移行总数 = 0（0 = 全等；wrapper 增补在 ccski 3.0 一等发现下为 no-op）。

已知分析性差异（不进入上表口径）：ccski 3.0 发现行额外携带 entryKind/canonicalPath/
ownership/mode 增量字段（z.object 收窄剥离，宿主投影不受影响，且为批 2.3 toggle 双路由
的依赖面——这是迁移收益不是漂移）。
