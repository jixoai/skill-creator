# Tasks: evaluation-corpus

## 1. 契约与存储

- [ ] 1.1 `src/shared/contracts/evaluation.ts`（case/result Zod 冻结 + 失败码枚举）
- [ ] 1.2 `src/daemon/evaluation/store.ts`（B1 布局；原子写；safeParse 空信封；
      Imported-only 写门；results 有界 20/case）
- [ ] 1.3 rpc-contract `evaluation.*` 六过程 + errors 词表对齐

## 2. runner

- [ ] 2.1 analyzer runner（analyzeDocuments 路径 + 模块版本常量）
- [ ] 2.2 builtin-fixture 导入器（10 条 → Imported 副本，source 标注）
- [ ] 2.3 provider-model runner（seed 内核会话；取消映射；版本三元组
      promptVersion/toolVersion/DSH version 写入 runner.version）

## 3. 协议执行

- [ ] 3.1 revision 闸：run 前/run 中 stale 转移；run 后展示级 stale
- [ ] 3.2 五态判定：passed 仅全 assertion 通过；error/unavailable 可区分
      （failure.code 枚举）；unavailable 永不 passed

## 4. 测试与门禁

- [ ] 4.1 Zod 正负例（case/result 全字段 + 判别联合）
- [ ] 4.2 CRUD 重启恢复（改盘 → 重读空信封重建；越权 Global 写拒绝）
- [ ] 4.3 runner 断言结果 + revision 漂移 stale + error/unavailable 区分 +
      取消/重试
- [ ] 4.4 provider-model 至少 1 条真实模型跑分证据（GOAL 107；模型不可用环境
      显式标 unavailable 并注明未闭合，不伪装 passed）
- [ ] 4.5 门禁：focused tests + typecheck + fmt + full build
