/**
 * 用户原始需求 [2026-07-20]：「预构建基于 color-symbol 的 appIcon：背景白色+合理的留白边界。」
 * 正交意图：
 *   [1] 证明生成物尺寸、透明外缘、白色底板与品牌内容的像素结构。
 *   [2] 证明生成过程不修改品牌源文件。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { generateSkillCreatorAppIcon } from "./app-icon.js";

const sandboxes: string[] = [];

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("Skill Creator app icon build", () => {
  it("places the color symbol inside a white rounded safe area", async () => {
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "skill-creator-app-icon-"));
    sandboxes.push(sandbox);
    const sourcePath = path.resolve("resources/color-symbol.png");
    const outputPath = path.join(sandbox, "nested", "app-icon.png");
    const sourceHashBefore = await sha256(sourcePath);

    await generateSkillCreatorAppIcon(sourcePath, outputPath);

    const image = sharp(outputPath);
    await expect(image.metadata()).resolves.toMatchObject({
      format: "png",
      width: 1024,
      height: 1024,
      channels: 4,
    });
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    expect(pixelAt(data, info.channels, info.width, 0, 512)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(data, info.channels, info.width, 96, 512)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(data, info.channels, info.width, 512, 96)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(data, info.channels, info.width, 512, 512)).not.toEqual([255, 255, 255, 255]);
    await expect(sha256(sourcePath)).resolves.toBe(sourceHashBefore);
  });
});

function pixelAt(data: Buffer, channels: number, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * channels;
  return [...data.subarray(offset, offset + channels)];
}

async function sha256(file: string): Promise<string> {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}
