/**
 * 用户原始需求 [2026-07-20]：「预构建基于 color-symbol 的 appIcon：背景白色+合理的留白边界。」
 * 正交意图：
 *   [1] 将品牌源图规范化为带白色安全区、适合 Dock/task switcher 的应用图标。
 *   [2] 在 Vite dev/build 配置完成前生成同一份静态产物。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { Plugin } from "vite";

const ICON_SIZE = 1024;
const TILE_INSET = 64;
const TILE_SIZE = ICON_SIZE - TILE_INSET * 2;
const TILE_RADIUS = 196;
const SYMBOL_SIZE = 704;

interface AppIconPluginOptions {
  sourcePath?: string;
  outputPath?: string;
}

/** Generate the normalized Skill Creator application icon from the full-color brand source. */
export async function generateSkillCreatorAppIcon(
  sourcePath: string,
  outputPath: string,
): Promise<void> {
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

  const whiteTile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}"><rect width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${TILE_RADIUS}" fill="#fff"/></svg>`,
  );
  const rendered = await sharp({
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

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, rendered);
}

/** Create the Vite plugin used by both serve and build modes. */
export function skillCreatorAppIcon(options: AppIconPluginOptions = {}): Plugin {
  const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const sourcePath = options.sourcePath ?? path.join(root, "resources", "color-symbol.png");
  const outputPath =
    options.outputPath ?? path.join(root, "webui", "static", "icons", "app-icon.png");

  return {
    name: "skill-creator/app-icon",
    enforce: "pre",
    async configResolved() {
      await generateSkillCreatorAppIcon(sourcePath, outputPath);
    },
  };
}
