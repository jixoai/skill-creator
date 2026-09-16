/**
 * DSH_HOME 缺省解析测试（skill-refs-and-platform-fixes C4）。
 *
 * 用户裁决路径（handoff 遗留 2 + Owner 未答复按推荐项推进）：daemon 内核宿主
 * 缺省隔离到 app home（`<homeDir()>/.skill-creator/dsh-home`），env DSH_HOME
 * 覆盖权保留——用户真实 `~/.dsh` 状态不再能压垮产品内核挂载。
 *
 * 正交意图：
 *   [1] 解析优先级：env（非空白）> app 隔离目录；不再读 `~/.dsh`。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDefaultDshHome } from "../src/daemon/dsh-host-lifecycle.js";
import { setHomeOverride } from "../src/shared/paths.js";

let sandbox = "";
let previousEnv: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "dsh-home-resolve-test-"));
  previousEnv = process.env.DSH_HOME;
  delete process.env.DSH_HOME;
  setHomeOverride(join(sandbox, "state"));
});

afterEach(() => {
  if (previousEnv === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousEnv;
  setHomeOverride(null);
  rmSync(sandbox, { recursive: true, force: true });
});

describe("resolveDefaultDshHome (C4 isolation)", () => {
  it("defaults to the app-scoped directory under homeDir, not ~/.dsh", () => {
    expect(resolveDefaultDshHome()).toBe(join(sandbox, "state", ".skill-creator", "dsh-home"));
  });

  it("keeps a non-blank DSH_HOME env override (rollback switch)", () => {
    process.env.DSH_HOME = join(sandbox, "custom-dsh");
    expect(resolveDefaultDshHome()).toBe(join(sandbox, "custom-dsh"));
  });

  it("ignores blank DSH_HOME values and falls back to the app default", () => {
    process.env.DSH_HOME = "   ";
    expect(resolveDefaultDshHome()).toBe(join(sandbox, "state", ".skill-creator", "dsh-home"));
  });
});
