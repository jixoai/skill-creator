# 可解释的优化前后评估（4.7）

生成：2026-09-07，`pnpm exec tsx scripts/steward-effectiveness.sh.ts`（原始逐条结果
含 findings/判定/理由：`steward-effectiveness.json`；回归固化：
`pnpm exec vitest run test/steward-effectiveness.test.ts` 3/3）。
analyzer：deterministic `analyzeDocuments`（`src/daemon/skill-intelligence/analyzer.ts`，
与 `skills.relations` 工具同一条代码路径）；模型版本：`steward-deterministic`
transport（无 live LLM 调用）。

**本评估不输出单一健康分。** 每条输入给出原始 findings（kind/severity/涉及技能/
message）、两个策略各自的判定（hit / miss / false-alarm / correctly-quiet）与
fixture 自带的判断理由；优化本身（策略门）带预期收益、失败风险与保留理由。

## 策略定义（优化前 → 优化后）

- **baseline（优化前）**：出现任何 finding 即提案（不分级别）。
- **candidate（优化后）**：只有 `warning+` 且属结构化类别（冲突：duplicate-name /
  duplicate-trigger / mutually-exclusive-rules / validation-error；文档缺陷：
  missing-description / empty-body）才提案；`info` 级背景（wide-trigger-surface、
  shared-resource-path、overlapping-responsibility）只进入人工复核清单，不提案。

## 结果矩阵（10 输入）

| #   | 输入（类别）                | 期望   | 原始 findings（kind@severity）                             | baseline        | candidate                          |
| --- | --------------------------- | ------ | ---------------------------------------------------------- | --------------- | ---------------------------------- |
| 01  | 冲突对：共享触发词          | 触发   | duplicate-trigger@warning                                  | hit             | hit                                |
| 02  | 冲突对：互斥规则            | 触发   | duplicate-trigger@warning + mutually-exclusive-rules@error | hit             | hit                                |
| 03  | 分工重叠对：同名            | 触发   | duplicate-name@error                                       | hit             | hit                                |
| 04  | 文档缺陷：缺 description    | 触发   | missing-description@warning                                | hit             | hit                                |
| 05  | 配套脚本技能：共享脚本+触发 | 触发   | duplicate-trigger@warning + shared-resource-path@info      | hit             | hit（shared-resource-path 转复核） |
| 06  | 分工清晰对                  | 不触发 | 无                                                         | correctly-quiet | correctly-quiet                    |
| 07  | 健康单技能                  | 不触发 | 无                                                         | correctly-quiet | correctly-quiet                    |
| 08  | 配套脚本各归其主            | 不触发 | 无                                                         | correctly-quiet | correctly-quiet                    |
| 09  | 仅宽触发面                  | 不触发 | wide-trigger-surface@info                                  | **false-alarm** | correctly-quiet（复核）            |
| 10  | 仅描述重叠                  | 不触发 | overlapping-responsibility@info                            | **false-alarm** | correctly-quiet（复核）            |

汇总：baseline = 5 hit / 0 miss / **2 false-alarm** / 3 quiet；candidate = 5 hit /
0 miss / **0 false-alarm** / 5 quiet。

## 逐优化判定（不把缩短字数当提升）

- **优化：info 级 findings 从提案面移入人工复核面（candidate 门）**
  - 预期收益：消除 2/5 的误触发（09/10—— wildcard 触发面与描述重叠各自都不是
    可自动执行的动作）；把「需要人判断的背景」与「可结构化提案的缺陷」分开。
  - 证据：上表 baseline 与 candidate 的逐条判定差异；原始 findings 在
    `steward-effectiveness.json` 每条 `findingsRaw`。
  - 失败风险：真实的分工重叠（10）若确需合并，会推迟到人工复核才处理——延迟
    换取正确性；复核清单在 UI 的 validation checks 面可见，不是静默丢弃。
  - 判定：**保留**。风险有明确补偿面（复核清单），收益可由回归测试复现。
- **未做并明确拒绝的「优化」**：按 description 相似度自动 merge（10 的 info 面
  直接升格为提案）。拒绝理由：相似 ≠ 可合并（10 的触发词与脚本完全分离）；
  在无使用历史佐证时自动合并会制造不可逆 churn（merge 后回滚虽可字节恢复，
  但审计成本高）。有使用历史时（当前全部 unknown）才可重新评估。
- **字数/体量类指标**：本评估不采用「字数减少=提升」——candidate 门对文档长度
  不敏感（01-05 触发均与字数无关）；token 记账见下节，仅作成本透明，不进判定。

## token 估算与真实消耗（区别记录）

- 估算：逐 case `content chars / 4` 上界启发（合计见 JSON
  `tokenAccounting.perCaseEstimateTotal`）。
- 真实消耗：每 case `realLlmTokens = 0`——deterministic transport 不发起模型调用。
  live 模型的真实消耗随 4.6 已记录的凭据 blocker（`PRESET_REQUIRES_CREDENTIAL`）
  补验后才有意义；届时估算与实测的差异将按同一格式并排记录。

## 使用历史与文档/资源完整性

- 使用历史：全部 10 条输入的技能均为 `unknown`（本产品当前无使用遥测源；未知
  显示 unknown，不默认为 0 或常用）。
- 完整性不退化：评估只读 fixture；每条 case 记录了全部技能 SKILL.md 的 sha256
  （JSON `cases[].skills[]`），回归测试重跑同一断言面。评估前后 fixture 树零变更。

## 门禁

`pnpm exec vitest run test/steward-effectiveness.test.ts` 3/3；全量门禁见 4.7
提交记录（464+3=467/467、typecheck、webui check、build、fmt、diff-check、openspec）。
