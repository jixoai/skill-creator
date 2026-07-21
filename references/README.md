<!--
文件意图（2026-07-22）
用户原始需求摘录：「在references文件夹下，git clone https://github.com/vercel-labs/skills/。」
正交意图：1. 说明本地社区目录研究检出的来源；2. 明确它不是发布或运行时依赖。
-->

# References

`skills/` 是本地研究检出，来源为 [vercel-labs/skills](https://github.com/vercel-labs/skills/)：

```bash
git clone https://github.com/vercel-labs/skills.git references/skills
```

Skill Creator 将其中 `src/agents.ts` 的 Agent skills 目录约定快照到 `src/shared/provider-catalog.ts`。运行时不读取此 checkout，发布包也不包含它；更新 catalog 时应先重新检出并审阅源差异。
