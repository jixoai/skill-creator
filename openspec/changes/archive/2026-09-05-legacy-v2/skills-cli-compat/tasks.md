## 1. Vendored lock 文件 Zod schema

- [x] 1.1 新建 `src/shared/contracts/skills-lock.ts`，定义全局锁 `GlobalSkillLockSchemaV3`（条目含 `source/sourceType/sourceUrl/ref?/skillPath?/skillFolderHash/installedAt/updatedAt/pluginName?`）与项目锁 `ProjectSkillLockSchemaV1`（条目含 `source/sourceUrl?/ref?/sourceType/skillPath?/computedHash/subagents?`），文件顶部声明 3 个正交意图
- [x] 1.2 导出 `parseGlobalSkillLock(unknown)` 与 `parseProjectSkillLock(unknown)`，内部 `safeParse` + 失败返回 `null`，禁止 `any`
- [x] 1.3 单测覆盖：合法 v3/v1 解析成功、结构不兼容返回 null、字段缺失返回 null、路径越界条目被剔除

## 2. skills-cli-probe daemon 模块

- [x] 2.1 新建 `src/daemon/skills-cli-compat.ts`，导出 `createSkillsCliProbe()`，内部封装「`npx skills list --json` shell-out + stdout safeParse + path→provenance 映射」
- [x] 2.2 probe 输出经独立 Zod schema（最小子集：`skillPath` + `source` 系列字段）解析；非 0 退出 / 超时 / 无 npx 返回空 map 且只记日志
- [x] 2.3 probe 结果按 daemon 生命周期缓存；暴露 `invalidate(paths?)` 供 update-check/apply-update 成功后失效
- [x] 2.4 单测：mock 子进程成功输出 / 非 0 退出 / 无 npx 三路径，断言不抛错

## 3. Provenance 投影（merge 进 SkillMetadata，daemon RPC 投影）

- [x] 3.1 在 `src/daemon/skill-service.ts` 的 list 投影里调用 probe，对每个技能按 path 命中映射后填 `installedVia: "skills-cli"` 与 `updatable`。这两个字段随 `skills.list` / `skills.info` RPC 响应下发，浏览器从响应渲染 badge，不在前端 memory 跨渲染周期缓存。
- [x] 3.2 `skillPath` 必须落在已注册 Workspace Provider 的 server-owned 目录内（复用 containment check），否则降级 `installedVia: "unknown"`
- [x] 3.3 探测失败 / 无映射时 `installedVia: "unknown"`、`updatable: false`
- [x] 3.4 单测：命中 / 越界 / 无探测三场景的投影断言

## 4. 契约变更（SkillMetadataSchema + 新 RPC）

- [x] 4.1 在 `src/shared/contracts/skills.ts` 给 `SkillMetadataSchema` 增加可选 `updatable: z.boolean()` 与 `installedVia: z.enum(["skills-cli","manual","unknown"])`（缺省值在投影层兜底，schema 仅声明可选）
- [x] 4.2 新建 `src/shared/contracts/skills-update.ts`：`UpdateCheckInputSchema`（含 WorkspaceProviderTarget）、`UpdateCheckResultSchema`（每项 `skillId/currentHash/upstreamHash/source/status ∈ {updated,already-current,failed,unavailable}`）、`ApplyUpdateInputSchema`（skillIds + target）、`ApplyUpdateResultSchema`（每项 `skillId/status ∈ {updated,already-current,failed}/error?`）
- [x] 4.3 在 `src/shared/rpc-contract.ts` 的 `skills` 命名空间下挂 `update.check` 与 `update.apply` 两个 procedure，input/output 全部走新 schema
- [x] 4.4 在 `src/daemon/rpc-router.ts` 注册两个 handler，复用既有 `domainErrorBoundary`；WebUI 类型从 `rpcContract` 推导，不另维护
- [x] 4.5 `pnpm check` 通过（typecheck + webui check）

## 5. Update checker（GitHub Trees API + on-disk hash 兜底）

- [x] 5.1 在 `skills-cli-compat.ts` 实现 `checkUpdates(target, skills)`：读全局 v3 + 项目 v1 lock，按技能 path 取 hash 与 source
- [x] 5.2 GitHub 源：解析 `sourceUrl` 得 `{owner,repo}`，对 `ref` 调 Trees API 取 tree SHA，与 `skillFolderHash` 对比；优先读 `GITHUB_TOKEN`/`GH_TOKEN`，未认证按 60/h 限流；按 `{owner,repo,ref}` daemon 生命周期缓存
- [x] 5.3 非 GitHub 源：浅克隆到 daemon 临时目录，用与 skills-CLI 一致算法算 `computeSkillFolderHash`（SHA-256 of on-disk files），与 `computedHash` 对比
- [x] 5.4 GitHub API 限流 / 网络失败 / 克隆失败分别归为 `unavailable` / `unavailable` / `failed`，不抛错
- [x] 5.5 单测：tree SHA 不等 / 相等、on-disk hash 不等 / 相等、限流、网络失败四场景

## 6. Apply update 流水线（复用 repository install + lock 刷新）

- [x] 6.1 在 `skills-cli-compat.ts` 实现 `applyUpdates(target, skillIds)`：用 lock 的 `{source,ref}` 触发一次 `repository.scan` → 选出对应技能 → `repository.install` 到原 target
- [x] 6.2 安装成功后用新 commit / 新 hash 刷新 lock 条目（`skillFolderHash`/`computedHash`/`updatedAt`）；当前决策为「仅在 Skill Creator 内存覆盖层刷新」，不写第三方文件（待 Open Question 关闭后定稿）
- [x] 6.3 安装冲突 / containment 失败透传既有 `DomainError`，不留半装文件
- [x] 6.4 已与上游一致的技能标记 `already-current` 不重装；失败项携带错误原因
- [x] 6.5 单测：成功刷新 hash / 冲突失败 / already-current / failed 四场景

## 7. UI（updatable badge + update-check 按钮 + update-result toast）

- [x] 7.1 Workspace 技能列表项：`installedVia === "skills-cli"` 且 `updatable` 时显示可升级 badge / icon。badge 数据来自 daemon `skills.list` RPC 投影，**不缓存在前端 memory 跨渲染周期**——每次列表渲染从最新 RPC 响应取值。
- [x] 7.2 技能列表工具栏或详情页加「检查更新」按钮，调用 `skills.update.check` RPC（daemon 侧计算 + 缓存 upstream hash）；结果一次性返回，浏览器渲染后不缓存。
- [x] 7.3 过时技能提供「升级」入口（逐项确认），调用 `skills.update.apply` RPC（daemon 侧复用 repository install 流水线 + 刷新 lock 条目）。
- [x] 7.4 结果区按 `updated / already-current / failed / unavailable` 分组展示，failed 给出错误原因、unavailable 提示「暂时无法检查」。daemon 侧后续若检测到上游变化（hash 缓存失效 / WS 推送），浏览器重新拉取 `skills.list` 投影刷新 badge。
- [x] 7.5 桌面（OpenTray ext-webview 原生窗）+ 窄屏（移动 web）双视觉验证，截图入档。
- [x] 7.6 loading / 禁用态：检查 / 升级进行中按钮禁用并显示 spinner（spinner 是组件局部 `$state`，瞬时 UI）。
- [x] 7.7 状态分层合规检查：lock 数据 / provenance / upstream hash / update-check 结果均不被写入前端 memory 跨渲染周期或 localStorage；浏览器仅作为视图层消费 RPC 响应。

## 8. 测试（lock parse / probe mock / hash 对比 / 优雅降级 / 状态分层）

- [x] 8.1 lock 文件解析单测（合法 / 不兼容 / 缺失 / 越界）覆盖全局 v3 与项目 v1
- [x] 8.2 probe mock 单测覆盖 npx 成功 / 非 0 退出 / 无 npx / 超时
- [x] 8.3 hash 对比单测覆盖 GitHub tree SHA 与 on-disk hash 两条路径的相等 / 不等
- [x] 8.4 优雅降级单测：无 npx + 无 lock + 限流 三者同时存在时 `skills.list` 与 `update-check` 均不抛错、返回安全默认
- [x] 8.5 状态分层单测：浏览器侧技能列表 badge 数据每次从 `skills.list` RPC 取（mock RPC 计数，切走再切回重新拉取）；update-check 结果不缓存在前端 memory；lock / provenance / hash 不写 localStorage
- [x] 8.6 `pnpm check` 全绿（test + typecheck + webui check + fmt），并运行 daemon 生命周期 focused tests（probe 缓存失效、apply 后刷新）
