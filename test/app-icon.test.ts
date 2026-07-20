/**
 * 用户原始需求 [2026-07-20]：「light 资产声明 default/light，dark 资产声明 dark；
 * Linux 保留 Vite 生成的 default PNG。」
 * 正交意图：
 * 1. 证明 Darwin/Windows 手工目录的变体投影与 staged 路径优先级。
 * 2. 证明 Linux 仍使用省略 variant 的 Vite 尺寸 PNG。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppIcon } from "../src/daemon/app-icon.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("AppIcon platform catalog", () => {
  it("projects staged Darwin light/default and dark variants", () => {
    const webuiDir = createWebuiDir(["app-icon/darwin-light.icns", "app-icon/darwin-dark.icns"]);

    expect(resolveAppIcon(webuiDir, "darwin")).toEqual([
      {
        platform: "darwin",
        format: "icns",
        variant: ["default", "light"],
        source: {
          type: "file",
          path: path.join(webuiDir, "icons", "app-icon", "darwin-light.icns"),
        },
      },
      {
        platform: "darwin",
        format: "icns",
        variant: "dark",
        source: {
          type: "file",
          path: path.join(webuiDir, "icons", "app-icon", "darwin-dark.icns"),
        },
      },
    ]);
  });

  it("projects staged Windows light/default and dark variants", () => {
    const webuiDir = createWebuiDir(["app-icon/win32-light.ico", "app-icon/win32-dark.ico"]);

    expect(resolveAppIcon(webuiDir, "win32")).toEqual([
      {
        platform: "windows",
        format: "ico",
        variant: ["default", "light"],
        source: {
          type: "file",
          path: path.join(webuiDir, "icons", "app-icon", "win32-light.ico"),
        },
      },
      {
        platform: "windows",
        format: "ico",
        variant: "dark",
        source: {
          type: "file",
          path: path.join(webuiDir, "icons", "app-icon", "win32-dark.ico"),
        },
      },
    ]);
  });

  it("keeps Vite-generated Linux PNGs on the implicit default variant", () => {
    const sizes = [16, 32, 48, 64, 128, 256, 512] as const;
    const webuiDir = createWebuiDir(sizes.map((size) => `linux/${size}x${size}/app-icon.png`));

    expect(resolveAppIcon(webuiDir, "linux")).toEqual(
      sizes.map((size) => ({
        platform: "linux",
        format: "png",
        size,
        source: {
          type: "file",
          path: path.join(webuiDir, "icons", "linux", `${size}x${size}`, "app-icon.png"),
        },
      })),
    );
  });
});

function createWebuiDir(iconFiles: readonly string[]): string {
  const webuiDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-app-icon-"));
  temporaryDirectories.push(webuiDir);
  for (const iconFile of iconFiles) {
    const file = path.join(webuiDir, "icons", iconFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, iconFile);
  }
  return webuiDir;
}
