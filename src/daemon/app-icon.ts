/**
 * 用户原始需求 [2026-07-20]：「macOS/Windows 使用 resources/app-icon 手工生成的
 * light/dark 资产；Linux 保留 Vite 生成的 default PNG。」
 * 正交意图：
 * 1. 将当前平台的应用身份资产投影为 OpenTray AppIcon 目录。
 * 2. 让 packaged dist 与 source/dev 使用同一套确定性查找顺序。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppIcon } from "opentray";

const LINUX_ICON_SIZES = [16, 32, 48, 64, 128, 256, 512] as const;

/** 解析当前平台的 App identity 目录；tray template 资产不属于该目录。 */
export function resolveAppIcon(
  webuiDir: string | undefined,
  platform: NodeJS.Platform = process.platform,
): AppIcon | null {
  if (platform === "darwin") {
    const [lightPath, darkPath] = resolveNativeVariantPair(
      "darwin-light.icns",
      "darwin-dark.icns",
      webuiDir,
    );
    return [
      {
        platform: "darwin",
        format: "icns",
        variant: ["default", "light"],
        source: { type: "file", path: lightPath },
      },
      {
        platform: "darwin",
        format: "icns",
        variant: "dark",
        source: { type: "file", path: darkPath },
      },
    ];
  }

  if (platform === "win32") {
    const [lightPath, darkPath] = resolveNativeVariantPair(
      "win32-light.ico",
      "win32-dark.ico",
      webuiDir,
    );
    return [
      {
        platform: "windows",
        format: "ico",
        variant: ["default", "light"],
        source: { type: "file", path: lightPath },
      },
      {
        platform: "windows",
        format: "ico",
        variant: "dark",
        source: { type: "file", path: darkPath },
      },
    ];
  }

  if (platform === "linux") {
    const assets: AppIcon = LINUX_ICON_SIZES.flatMap((size) => {
      const iconPath = resolvePackagedIconPath(
        path.join("linux", `${size}x${size}`, "app-icon.png"),
        webuiDir,
      );
      return iconPath === null
        ? []
        : [
            {
              platform: "linux" as const,
              format: "png" as const,
              size,
              source: { type: "file" as const, path: iconPath },
            },
          ];
    });
    return assets.length === 0 ? null : assets;
  }

  return null;
}

function resolveNativeVariantPair(
  lightFileName: string,
  darkFileName: string,
  webuiDir: string | undefined,
): readonly [string, string] {
  const lightPath = resolveNativeAppIconPath(lightFileName, webuiDir);
  const darkPath = resolveNativeAppIconPath(darkFileName, webuiDir);
  if (lightPath === null || darkPath === null) {
    throw new Error(
      `incomplete native appIcon variants: ${lightFileName}=${lightPath ?? "missing"}, ${darkFileName}=${darkPath ?? "missing"}`,
    );
  }
  return [lightPath, darkPath];
}

function resolveNativeAppIconPath(fileName: string, webuiDir: string | undefined): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    webuiDir ? path.join(webuiDir, "icons", "app-icon", fileName) : null,
    path.join(here, "webui", "icons", "app-icon", fileName),
    path.join(here, "..", "resources", "app-icon", fileName),
    path.join(here, "..", "..", "resources", "app-icon", fileName),
    path.join(process.cwd(), "resources", "app-icon", fileName),
  ];
  return firstExistingFile(candidates);
}

function resolvePackagedIconPath(fileName: string, webuiDir: string | undefined): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    webuiDir ? path.join(webuiDir, "icons", fileName) : null,
    path.join(here, "webui", "icons", fileName),
    path.join(here, "..", "..", "webui", "build", "icons", fileName),
    path.join(here, "..", "..", "webui", "static", "icons", fileName),
    path.join(process.cwd(), "webui", "build", "icons", fileName),
    path.join(process.cwd(), "webui", "static", "icons", fileName),
  ];
  return firstExistingFile(candidates);
}

function firstExistingFile(candidates: ReadonlyArray<string | null>): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}
