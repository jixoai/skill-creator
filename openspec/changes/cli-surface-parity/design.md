# Design: cli-surface-parity

## D1 — 同源组装与生命周期

CLI 命令族进程内调用 `createDaemonDomain()`（`mcp` stdio 的同一先例），消费与
rpc-router 相同的 domain 服务实例方法。禁止：CLI 内重写 toggle 冲突判定、update
状态投影、settings 拒绝码——这些规则只存在于 domain 层。

```text
runSkillsCli / runModelCli
  |-- createDaemonDomain()        短命进程；npx probe 后台预热随进程退出回收
  |-- domain.workspaces.list()    引用解析的 id/label 数据源（不写回）
  |-- domain.skills / skillsUpdate / skillSearch / dshSettings / modelCatalog
  `-- process.exit(code)          0 成功 / 1 业务失败 / 2 用法错误
```

## D2 — 引用解析（人类可读 → opaque）

三段位置参数 `<wsRef> <pRef> <skillRef>`（不用斜杠复合语法——shell 引号负担与
provider 名含 `-` 的歧义不值得）。

```text
wsRef    `~`            -> Global Workspace（id="~"）
         path-shaped    -> realpath 反查 registry（含 "./" 缺省当前目录）
         bare token     -> ws_* id 精确 -> label 前缀（ci）
pRef     bare token     -> provider id 精确 -> label 前缀（ci）；仅在该 workspace 下解析
skillRef                -> name 精确（ci）-> directoryName 精确 -> sk_ id 精确
歧义/零匹配            -> stderr 列候选，exit 2
```

`skills list` 缺省 = 全部 workspace × 全部 provider（只读聚合）；其余作用域命令
要求显式 wsRef。`--provider` 过滤仅作用于 list。

## D3 — skills 族语义（逐命令）

- `list`：`includeDisabled` 由 `--all` 置真；输出列 = name/disabled/provider/
  provenance（installedVia/updatable）；`--json` 输出 `SkillMetadata[]` 原始契约。
- `info`：输出正文 + frontmatter 摘要；`--json` 输出 `SkillInfo` 契约。
- `validate`：逐条打印 issue（level/message）；退出码按 `valid` 投影（0/1）。
- `toggle`：复数 skillRef；symlink 目标命中 conflict 时逐条打印 conflict 行
  （domain 已内置 guard），任一非成功 → exit 1。
- `duplicates`：`skillSearch.duplicates` 全量分组；文本模式按组列出 canonical
  代表 + installations；`--json` 输出契约。
- `update check <wsRef> <pRef>`：显式作用域（每个作用域一次上游探测，不做
  全 workspace 隐式扫描）；逐技能打印 updated/already-current/failed/unavailable。
- `update apply <wsRef> <pRef> <name...>`：只允许 apply check 已确认 `updated`
  的名字（domain 强制）；逐项打印 installed/failed/skipped 汇总忠实投影，
  partial success 保留已完成项（domain 语义），exit 1 当且仅当存在 failed。

## D4 — model 族语义

- `list`：`modelCatalog.list()` 目录全量 + `dshSettings.getView()` 路由标注
  （`*` = 已配置路由；`active` = 当前选择）；`--json` 输出 `{catalog, routes, model}`。
- `routes`：路由表（provider/api/baseURL/models）+ 凭据 configured 状态
  （**不回显 key 明文**——CLI 终端会进 shell 历史/日志，与 WebUI 的 R16 客观
  回显裁决不同面；只打 `configured: yes/no`）。
- `use <provider> <model> [--effort t]`：provider 已有路由 → 直接
  `update({model})`；provider 仅在目录 → 以目录条目自动补路由（api/baseURL/
  models 由目录推导）再 update；两者皆无 → exit 2 提示 `route add`。effort
  缺省不传（保留现值）；传值必须 ∈ 该模型 effortTiers（目录）或路由 efforts。
- `route add`：`--base-url` 必填；`--api` 缺省从目录同名 provider 推导，无目录
  命中且未显式 `--api` → exit 2；`--model <id>` 可重复（至少 1 个）。实现为
  读-改-写 `modelRoutes` 整表替换（契约唯一表达），已存在同名 provider → exit 2
  （改路由 = remove + add，无原地编辑歧义）。
- `route remove <provider>`：整表替换过滤；活动模型落在该 provider 时拒绝
  （先 `use` 切走）——domain `MODEL_PROVIDER_WITHOUT_CREDENTIAL` 之外的前置
  本地校验，避免移除后 resolve 断链。
- `key set/clear`：`dshSettings.setCredential/clearCredential` 原样透传；
  `key set <provider> -` 从 stdin 读（避免 key 进 shell 历史）。
- `test [<provider> [<model>]]`：缺省用活动路由；构造
  `DshRouteConnectionTestInput`（apiKey 缺省由 daemon 从已存凭据注入——契约
  语义）；结果 typed 打印（ok+latency / failed+detail），failed → exit 1。

## D5 — setup 模型参数段

```text
skill-creator setup [--backup] [--model <provider>/<model>] [--effort <tier>]
                    [--base-url <url>] [--api <protocol>] [--api-key <key>]
```

- `--model` 是模型段开关：无 `--model` 时其余模型 flag 出现 → exit 2（防半配置）。
- 段内顺序：key set（如传）→ route add（provider 无路由且 `--base-url` 在场时；
  已有路由则跳过建路由）→ `use`（含 effort）→（未传 `--api-key` 则不做凭据动作）。
- `--api-key none`（ci）= 显式无 key：跳过凭据写入（端点免鉴权场景），不把字面
  "none" 写进凭据文件。
- `--model <p>/<m>` 解析失败（缺 `/`）→ exit 2。
- 模型段任何业务失败 → stderr 打印 + exit 1；已完成的 symlink/agents-md 结果
  不回滚（幂等：重跑 setup 即续配）。

## D6 — 测试矩阵（spawn + env 沙箱）

沿用 `self-skill-cli.test.ts` 的真进程 spawn 模式；隔离 = `SKILL_CREATOR_HOME`
（同时切走 workspace registry、dsh settings/credentials 的 appDir 派生根）+
fixture workspace 目录注入技能语料。

- 解析：label 前缀唯一命中 / 歧义列候选 exit 2 / `~` / 路径反查。
- list/info/validate/toggle：真 fixture 断言文本与 `--json` 契约形状；toggle
  symlink conflict 行投影。
- duplicates：两份同内容 fixture → 一组。
- update check/apply：stub 不可行（真 git clone）——集成面只测用法错误与
  `unavailable`/skipped 投影路径（无网络假设）；语义层已由
  `skills-update.test.ts` 覆盖，此处不重复。
- model 族：route add/remove/use/key set/clear/routes/list 全走真文件断言
  （沙箱 home 下 dsh-settings.json + credentials）；`test` 断言 typed failed
  （不可达端点）不抛且 exit 1。
- setup --model：端到端一次（valve 沙箱 + SKILL_CREATOR_HOME 沙箱），断言
  settings 落盘 + exit 0；`--model` 缺 provider 路由且无 `--base-url` → exit 2。

## D7 — 文档同步

`skills/skill-creator-v2/references/tools.md` 的 CLI 参考表补 skills/model 族
（引导块指向的单一事实源）；SKILL.md 正文不加长（表在 references）。
