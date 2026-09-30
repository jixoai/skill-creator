# Tasks: evaluation-corpus

## 1. 契约与存储

- [x] 1.1 `src/shared/contracts/evaluation.ts`（case/result Zod 判别联合冻结 + 失败码全枚举互斥 + RPC io 八过程 + 结构化版本三元组）
- [x] 1.2 `src/daemon/evaluation/store.ts`（B1 布局；原子写；空信封重建；
      Imported-only 写门；results 有界 20/case + resultId 幂等；IO hard error）
- [x] 1.3 rpc-contract `evaluation.*` 八过程 + router handlers（caseIds 前置校验；
      fixture×provider 组合前置拒绝；errors 词表对齐）

## 2. runner

- [x] 2.1 analyzer runner（user case 活语料全量分析 + fixture case digest 定位
      确定性回归分支 + 模块版本常量）
- [x] 2.2 builtin-fixture 导入器（十条例矩阵全参数落契 + corpusDigest 幂等；
      4 例测试含期望矩阵迁移实证 duplicate-name passed）
- [x] 2.3 provider-model runner + B7 adapter（create/prompt+references/
      readTranscript turn-end 终态/cancel 竞态胜者/结构化版本三元组；
      缺适配器 → 依赖族 unavailable）

## 3. 协议执行

- [x] 3.1 revision 闸：run 前/run 中 stale 转移；run 后展示级 stale（服务测试实证）
- [x] 3.2 五态判定：passed 仅全 assertion 通过；error/unavailable 族互斥
      （schema refine + 测试）；unavailable 断言恒空

## 4. 测试与门禁

- [ ] 4.1 Zod 正负例（case/result 全字段 + 判别联合）
- [ ] 4.2 CRUD 重启恢复（改盘 → 重读空信封重建；越权 Global 写拒绝）
- [ ] 4.3 runner 断言结果 + revision 漂移 stale + error/unavailable 区分 +
      取消/重试
- [ ] 4.4 provider-model 至少 1 条真实模型跑分证据（GOAL 107；模型不可用环境
      显式标 unavailable 并注明未闭合，不伪装 passed）
- [ ] 4.5 门禁：focused tests + typecheck + fmt + full build
