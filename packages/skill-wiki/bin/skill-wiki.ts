#!/usr/bin/env node
/**
 * 用户原始需求 [2026-09-21]（jixoai-search-core 3.3）：「skill-wiki CLI 随包私有
 * （bin 供本地测试直跑 node/tsx；发布时生效）」。
 * 正交意图：
 *   [1] 进程适配层：process argv/stdin/stdout → runCli 纯函数面，退出码透传。
 * 妥协声明：private 包 bin 指向 TS 源（src 直出无构建步）；node 直跑需 tsx
 * loader（`node --import tsx bin/skill-wiki.ts` 或 `pnpm exec tsx bin/skill-wiki.ts`）。
 */
import { runCli } from "../src/cli.js";

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

const code = await runCli(process.argv.slice(2), io);
process.exit(code);
