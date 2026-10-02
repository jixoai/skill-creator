# Tasks: proposal-view-assertion

- [x] 1.1 `test/agent-proposals-projection.test.ts` 追加 approved 中间态
      直通断言（status 原样投影 + result 缺席）
- [x] 1.2 聚焦测试跑绿：`pnpm exec vp test run
test/agent-proposals-projection.test.ts` → 12/12 passed（原 11 例 +1）
- [x] 1.3 门禁：`openspec validate proposal-view-assertion --strict` 通过；
      触碰文件 fmt
