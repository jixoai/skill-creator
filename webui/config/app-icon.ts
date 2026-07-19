/**
 * 用户原始需求 [2026-07-20]：「预构建基于 color-symbol 的 appIcon：背景白色+合理的留白边界。」
 * 用户补充需求 [2026-07-20]：「改用专业库生成符合 macOS 的 squircle 圆角和标准多尺寸 ICNS，并加生成缓存。」
 * 正交意图：
 *   [1] 将品牌源图规范化为带白色安全区、适合 Dock/task switcher 的应用图标。
 *   [2] 生成包含标准多尺寸条目的 macOS ICNS 产物。
 *   [3] 在 Vite dev/build 配置完成前，以源图与配方身份缓存生成结果。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSvgPath } from "figma-squircle";
import iconGen from "icon-gen";
import sharp from "sharp";
import type { Plugin } from "vite";

const ICON_SIZE = 1024;
const TILE_INSET = 64;
const TILE_SIZE = ICON_SIZE - TILE_INSET * 2;
const TILE_RADIUS = 196;
const TILE_SMOOTHING = 1;
const SYMBOL_SIZE = 704;
const CACHE_SCHEMA_VERSION = 1;
const RECIPE_ID = `squircle-v1:${ICON_SIZE}:${TILE_INSET}:${TILE_RADIUS}:${TILE_SMOOTHING}:${SYMBOL_SIZE}`;
const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024] as const;

interface AppIconPluginOptions {
  sourcePath?: string;
  outputPath?: string;
  icnsOutputPath?: string;
  cachePath?: string;
}

interface AppIconCacheMetadata {
  schemaVersion: number;
  sourceSha256: string;
  recipeVersion: string;
  encoderVersion: string;
  outputPath: string;
  icnsOutputPath: string;
}

/** Generate the normalized PNG and macOS ICNS application icons. */
export async function generateSkillCreatorAppIcon(
  sourcePath: string,
  outputPath: string,
  icnsOutputPath = path.join(path.dirname(outputPath), "app-icon.icns"),
  cachePath = path.join(path.dirname(path.dirname(outputPath)), ".cache", "app-icon.json"),
): Promise<void> {
  const sourceSha256 = await sha256(sourcePath);
  const encoderVersion = await readPackageVersion(
    fileURLToPath(new URL("../node_modules/icon-gen/package.json", import.meta.url)),
  );
  const squircleVersion = await readPackageVersion(
    fileURLToPath(new URL("../node_modules/figma-squircle/package.json", import.meta.url)),
  );
  const cache: AppIconCacheMetadata = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    sourceSha256,
    recipeVersion: `${RECIPE_ID};figma-squircle@${squircleVersion}`,
    encoderVersion,
    outputPath,
    icnsOutputPath,
  };
  if (await cacheMatches(cachePath, cache)) return;

  const rendered = await renderAppIcon(sourcePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(path.dirname(icnsOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(outputPath, rendered);
  await encodeIcns(rendered, icnsOutputPath);
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

/** Create the Vite plugin used by both serve and build modes. */
export function skillCreatorAppIcon(options: AppIconPluginOptions = {}): Plugin {
  const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const sourcePath = options.sourcePath ?? path.join(root, "resources", "color-symbol.png");
  const outputPath =
    options.outputPath ?? path.join(root, "webui", "static", "icons", "app-icon.png");
  const icnsOutputPath =
    options.icnsOutputPath ?? path.join(root, "webui", "static", "icons", "app-icon.icns");
  const cachePath = options.cachePath ?? path.join(root, "webui", ".cache", "app-icon.json");
  let generation: Promise<void> | undefined;

  return {
    name: "skill-creator/app-icon",
    enforce: "pre",
    async configResolved() {
      generation ??= generateSkillCreatorAppIcon(sourcePath, outputPath, icnsOutputPath, cachePath);
      await generation;
    },
  };
}

async function renderAppIcon(sourcePath: string): Promise<Buffer> {
  const symbol = await sharp(sourcePath)
    .trim({ threshold: 0 })
    .resize(SYMBOL_SIZE, SYMBOL_SIZE, {
      fit: "inside",
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const symbolLeft = Math.round((ICON_SIZE - symbol.info.width) / 2);
  const symbolTop = Math.round((ICON_SIZE - symbol.info.height) / 2);
  const squirclePath = getSvgPath({
    width: TILE_SIZE,
    height: TILE_SIZE,
    cornerRadius: TILE_RADIUS,
    cornerSmoothing: TILE_SMOOTHING,
    preserveSmoothing: true,
  });
  const whiteTile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}"><path d="${squirclePath}" fill="#fff"/></svg>`,
  );
  return sharp({
    create: {
      width: ICON_SIZE,
      height: ICON_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: whiteTile, top: TILE_INSET, left: TILE_INSET },
      { input: symbol.data, top: symbolTop, left: symbolLeft },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function encodeIcns(rendered: Buffer, outputPath: string): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-creator-icon-gen-"));
  try {
    await Promise.all(
      ICNS_SIZES.map(async (size) => {
        const png = await sharp(rendered)
          .resize(size, size, { fit: "contain" })
          .png({ compressionLevel: 9 })
          .toBuffer();
        await fs.writeFile(path.join(tempDir, `${size}.png`), png);
      }),
    );
    const generated = await iconGen(tempDir, path.dirname(outputPath), {
      report: false,
      icns: {
        name: path.basename(outputPath, ".icns"),
        sizes: [...ICNS_SIZES],
      },
    });
    const generatedPath = generated[0];
    if (generatedPath === undefined) {
      throw new Error("icon-gen did not return an ICNS output path");
    }
    if (path.resolve(generatedPath) !== path.resolve(outputPath)) {
      await fs.rename(generatedPath, outputPath);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function cacheMatches(file: string, expected: AppIconCacheMetadata): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!isAppIconCacheMetadata(parsed) || !sameCacheIdentity(parsed, expected)) return false;
    await Promise.all([fs.access(expected.outputPath), fs.access(expected.icnsOutputPath)]);
    return true;
  } catch {
    return false;
  }
}

function sameCacheIdentity(a: AppIconCacheMetadata, b: AppIconCacheMetadata): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.sourceSha256 === b.sourceSha256 &&
    a.recipeVersion === b.recipeVersion &&
    a.encoderVersion === b.encoderVersion &&
    a.outputPath === b.outputPath &&
    a.icnsOutputPath === b.icnsOutputPath
  );
}

function isAppIconCacheMetadata(value: unknown): value is AppIconCacheMetadata {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.schemaVersion === "number" &&
    typeof record.sourceSha256 === "string" &&
    typeof record.recipeVersion === "string" &&
    typeof record.encoderVersion === "string" &&
    typeof record.outputPath === "string" &&
    typeof record.icnsOutputPath === "string"
  );
}

async function readPackageVersion(file: string): Promise<string> {
  const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string"
  ) {
    throw new Error(`Invalid package identity in ${file}`);
  }
  return parsed.version;
}

async function sha256(file: string): Promise<string> {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}
