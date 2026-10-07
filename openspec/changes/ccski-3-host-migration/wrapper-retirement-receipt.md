# ccski-symlink-entries 退役收据（批 3.1 · 无漂移复跑对照表）

> 生成方式：`bun scripts/ccski-wrapper-receipt.sh.ts`（可复跑；本文件与
> `wrapper-retirement-receipt.json`（结构化原始收据）均为其确定性产物，
> 复跑 `git diff` 为空即无漂移）。wrapper 半边经
> `git show fe52b62^:src/daemon/ccski-symlink-entries.ts` 恢复源码动态 import；
> 直连半边 = 当前 node_modules 的 ccski 3.0.0 `listSkills`。
> fixture 语料：真实目录 enabled/disabled + symlink enabled/disabled-only/
> 非 skill 目标/坏 frontmatter/悬空链，customDirs 单 root、scanDefaultDirs:false。
> 字段口径 = 宿主消费面七字段；行键 = `name|canonicalPath|disabled`（标题
> 呈现，不进表格单元格——批 3.1 版把行键放进表格首列 code span，`|` 拆列
> 即终审 P1-6 抓出的缺陷）。

## 调用形状：all:true

### `disabled-link|/private<fixture>/lib/disabled-link|true`

| 字段           | wrapper 在场                          | 直连 ccski 3.0                        | 比较 |
| -------------- | ------------------------------------- | ------------------------------------- | ---- |
| provider       | `cline`                               | `cline`                               | 全等 |
| location       | `user`                                | `user`                                | 全等 |
| sourceKind     | `custom`                              | `custom`                              | 全等 |
| sourcePriority | `500`                                 | `500`                                 | 全等 |
| disabled       | `true`                                | `true`                                | 全等 |
| canonicalPath  | `/private<fixture>/lib/disabled-link` | `/private<fixture>/lib/disabled-link` | 全等 |
| directoryName  | `disabled-link`                       | `disabled-link`                       | 全等 |

### `linked-skill|/private<fixture>/lib/linked-skill|false`

| 字段           | wrapper 在场                         | 直连 ccski 3.0                       | 比较 |
| -------------- | ------------------------------------ | ------------------------------------ | ---- |
| provider       | `cline`                              | `cline`                              | 全等 |
| location       | `user`                               | `user`                               | 全等 |
| sourceKind     | `custom`                             | `custom`                             | 全等 |
| sourcePriority | `500`                                | `500`                                | 全等 |
| disabled       | `false`                              | `false`                              | 全等 |
| canonicalPath  | `/private<fixture>/lib/linked-skill` | `/private<fixture>/lib/linked-skill` | 全等 |
| directoryName  | `linked-skill`                       | `linked-skill`                       | 全等 |

### `real-disabled|/private<fixture>/provider-root/real-disabled|true`

| 字段           | wrapper 在场                                    | 直连 ccski 3.0                                  | 比较 |
| -------------- | ----------------------------------------------- | ----------------------------------------------- | ---- |
| provider       | `cline`                                         | `cline`                                         | 全等 |
| location       | `user`                                          | `user`                                          | 全等 |
| sourceKind     | `custom`                                        | `custom`                                        | 全等 |
| sourcePriority | `500`                                           | `500`                                           | 全等 |
| disabled       | `true`                                          | `true`                                          | 全等 |
| canonicalPath  | `/private<fixture>/provider-root/real-disabled` | `/private<fixture>/provider-root/real-disabled` | 全等 |
| directoryName  | `real-disabled`                                 | `real-disabled`                                 | 全等 |

### `real-enabled|/private<fixture>/provider-root/real-enabled|false`

| 字段           | wrapper 在场                                   | 直连 ccski 3.0                                 | 比较 |
| -------------- | ---------------------------------------------- | ---------------------------------------------- | ---- |
| provider       | `cline`                                        | `cline`                                        | 全等 |
| location       | `user`                                         | `user`                                         | 全等 |
| sourceKind     | `custom`                                       | `custom`                                       | 全等 |
| sourcePriority | `500`                                          | `500`                                          | 全等 |
| disabled       | `false`                                        | `false`                                        | 全等 |
| canonicalPath  | `/private<fixture>/provider-root/real-enabled` | `/private<fixture>/provider-root/real-enabled` | 全等 |
| directoryName  | `real-enabled`                                 | `real-enabled`                                 | 全等 |

- 行数：wrapper=4，直连=4；字段漂移=0；仅 wrapper=0；仅直连=0；重复键 wrapper=0、直连=0（P1-F：以上六项任一非零 → 门禁 exit 1）。

## 调用形状：all:false

### `linked-skill|/private<fixture>/lib/linked-skill|false`

| 字段           | wrapper 在场                         | 直连 ccski 3.0                       | 比较 |
| -------------- | ------------------------------------ | ------------------------------------ | ---- |
| provider       | `cline`                              | `cline`                              | 全等 |
| location       | `user`                               | `user`                               | 全等 |
| sourceKind     | `custom`                             | `custom`                             | 全等 |
| sourcePriority | `500`                                | `500`                                | 全等 |
| disabled       | `false`                              | `false`                              | 全等 |
| canonicalPath  | `/private<fixture>/lib/linked-skill` | `/private<fixture>/lib/linked-skill` | 全等 |
| directoryName  | `linked-skill`                       | `linked-skill`                       | 全等 |

### `real-enabled|/private<fixture>/provider-root/real-enabled|false`

| 字段           | wrapper 在场                                   | 直连 ccski 3.0                                 | 比较 |
| -------------- | ---------------------------------------------- | ---------------------------------------------- | ---- |
| provider       | `cline`                                        | `cline`                                        | 全等 |
| location       | `user`                                         | `user`                                         | 全等 |
| sourceKind     | `custom`                                       | `custom`                                       | 全等 |
| sourcePriority | `500`                                          | `500`                                          | 全等 |
| disabled       | `false`                                        | `false`                                        | 全等 |
| canonicalPath  | `/private<fixture>/provider-root/real-enabled` | `/private<fixture>/provider-root/real-enabled` | 全等 |
| directoryName  | `real-enabled`                                 | `real-enabled`                                 | 全等 |

- 行数：wrapper=2，直连=2；字段漂移=0；仅 wrapper=0；仅直连=0；重复键 wrapper=0、直连=0（P1-F：以上六项任一非零 → 门禁 exit 1）。

## 结论

漂移字段总数 = 0（0 = 全等；wrapper 增补在 ccski 3.0 一等发现下为 no-op）。

门禁：绿（字段漂移 / 缺行 / 重复键全部为零，P1-F 六项门禁全过）。

已知分析性差异（不进入上表口径）：ccski 3.0 发现行额外携带 entryKind/canonicalPath/
ownership/mode 增量字段（z.object 收窄剥离，宿主投影不受影响，且为批 2.3 toggle 双路由
的依赖面——这是迁移收益不是漂移）。
