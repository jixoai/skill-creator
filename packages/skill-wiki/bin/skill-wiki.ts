#!/usr/bin/env node
/**
 * 用户原始需求 [2026-09-21]（jixoai-search-core 3.3）：「skill-wiki CLI 随包私有
 * （bin 供本地测试直跑 node/tsx；发布时生效）」。
 * 修订 [2026-09-22]（wiki-directory-standard 2.1）：改用 cli-kit 默认实例
 * （createWikiCli() 空 host = 重构前 runCli 行为，逐位一致由现有测试守护）。
 * 正交意图：
 *   [1] 进程适配层：process argv/stdin/stdout → kit 默认实例纯函数面，退出码透传。
 * 妥协声明：private 包 bin 指向 TS 源（src 直出无构建步）；node 直跑需 tsx
 * loader（`node --import tsx bin/skill-wiki.ts` 或 `pnpm exec tsx bin/skill-wiki.ts`）。
 */
import { createWikiCli } from "../src/cli.js";

const io = {
  readStdin: async (): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  },
  stdout: (text: string): void => {
    process.stdout.write(text);
  },
  stderr: (text: string): void => {
    process.stderr.write(text);
  },
};

const cli = createWikiCli();
const code = await cli.run(process.argv.slice(2), io);
process.exit(code);
