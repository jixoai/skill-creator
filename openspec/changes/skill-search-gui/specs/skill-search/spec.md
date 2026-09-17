# skill-search 变更（增量：GUI 消费方）

## ADDED Requirements

### Requirement: skills store 提供 latest-request-wins 的检索动作

`searchSkills(query, limit?)` MUST 复用 request-generation 代次门 +
connection owner generation（断线重连后旧响应不得提交）；空/全空白 query
MUST NOT 发起 RPC（输入 schema min-1 是合同）并清空结果态；提交与 loading
清理遵循 isCurrent / isLatest 分工。结果态 MUST 携带完整
SkillSearchResult（含 installations 作用域三元组）。

#### Scenario: 断线重连不提交旧响应

- **WHEN** 检索在途时连接替换（owner generation++）
- **THEN** 旧响应被丢弃，重连后由新请求重新提交

### Requirement: ProviderView 过滤以后端检索为主、前端过滤为降级

URL `q` 参数仍是过滤状态的唯一真相源；非空 `q` 经 debounce 触发
`skills.search`，列表渲染检索投影（BM25 排序）；检索失败（断线/错误）MUST
降级为当前已载技能的前端 includes 过滤并给出错误提示，不得渲染空白。

#### Scenario: 中文查询命中

- **WHEN** 在 ProviderView 输入「组件设计」
- **THEN** 列表由 BM25 检索排序（含中文分词命中），而非仅子串匹配

#### Scenario: 断线降级不空白

- **WHEN** 检索请求失败
- **THEN** 列表回退前端 includes 过滤并显示错误提示

### Requirement: 命令面板提供跨 Workspace 的 Skills 全局搜索

Cmd/Ctrl+K 面板 MUST 增异步 Skills 组：输入 debounce 后走 `skills.search`
（加载态可见），结果按 workspace/provider 分组，选中跳转对应 provider
路由并打开技能详情（`?skill=…&view=detail`）。窄屏保持面板 Dialog 可用。

#### Scenario: 全局发现到详情

- **WHEN** 在面板输入技能关键词并选中结果
- **THEN** 导航到该技能所属 workspace/provider 的 ProviderView 且详情打开

### Requirement: composer `$` 菜单以 BM25 检索为数据源

`$` 态且 needle 非空时经 debounce 调 `skills.search`；菜单行从结果
installations 派生（组头 = workspace label / provider label；同一技能多
安装呈现多行同引用）；空 needle 显示占位提示而非全量列表；选中语义不变
（`$name` token + skill 三元组引用入 registry）；断线沿 getRpc() 优雅
失败先例。全量拉取路径 MUST 移除。

#### Scenario: 中文与 typo 输入

- **WHEN** `$` 菜单输入「组件」或拼错的技能名
- **THEN** BM25/分词/模糊召回目标技能，选中后引用正确落稿
