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
    const icnsPath = path.join(sandbox, "nested", "app-icon.icns");
    const icns = await fs.readFile(icnsPath);
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(readIcnsTags(icns)).toEqual(
      expect.arrayContaining([
        "ic07",
        "ic08",
        "ic09",
        "ic10",
        "ic11",
        "ic12",
        "ic13",
        "ic14",
        "is32",
        "il32",
        "s8mk",
        "l8mk",
      ]),
    );
    const firstPngStat = await fs.stat(outputPath, { bigint: true });
    const firstIcnsStat = await fs.stat(icnsPath, { bigint: true });
    const cache = JSON.parse(
      await fs.readFile(path.join(sandbox, ".cache", "app-icon.json"), "utf8"),
    ) as { sourceSha256: string; recipeVersion: string; encoderVersion: string };
    expect(cache.sourceSha256).toBe(sourceHashBefore);
    expect(cache.recipeVersion).toContain("figma-squircle@1.1.0");
    expect(cache.encoderVersion).toBe("5.0.0");

    await generateSkillCreatorAppIcon(sourcePath, outputPath);
    await expect(fs.stat(outputPath, { bigint: true })).resolves.toMatchObject({
      mtimeNs: firstPngStat.mtimeNs,
    });
    await expect(fs.stat(icnsPath, { bigint: true })).resolves.toMatchObject({
      mtimeNs: firstIcnsStat.mtimeNs,
    });
    await expect(sha256(sourcePath)).resolves.toBe(sourceHashBefore);
  });
});

function readIcnsTags(data: Buffer): string[] {
  const tags: string[] = [];
  for (let offset = 8; offset + 8 <= data.length; ) {
    const type = data.subarray(offset, offset + 4).toString("ascii");
    const size = data.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > data.length) break;
    if (type !== "TOC ") tags.push(type);
    offset += size;
  }
  return tags;
}

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
