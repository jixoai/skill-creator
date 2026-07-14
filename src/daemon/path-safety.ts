/**
 * Canonical filesystem boundary helpers.
 *
 * User intent [2026-07-14]: workspace operations must never escape the
 * directory the person imported.
 *
 * Orthogonal intents:
 *   [1] Stable opaque IDs from canonical paths.
 *   [2] Direct-child containment checks for destructive operations.
 *   [3] Atomic UTF-8 writes and content revisions.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function opaquePathId(prefix: "ws" | "sk", canonicalPath: string): string {
  return `${prefix}_${createHash("sha256").update(canonicalPath).digest("hex").slice(0, 24)}`;
}

export function contentRevision(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function canonicalDirectory(input: string): string {
  const resolved = path.resolve(input);
  const canonical = fs.realpathSync(resolved);
  if (!fs.statSync(canonical).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }
  return canonical;
}

export function directChild(root: string, name: string): string {
  const candidate = path.resolve(root, name);
  if (path.dirname(candidate) !== path.resolve(root)) {
    throw new Error(`Path must be a direct child of the workspace: ${name}`);
  }
  return candidate;
}

export function assertPathInside(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  ) {
    return;
  }
  throw new Error(`Path escapes its allowed root: ${candidate}`);
}

export function atomicWriteUtf8(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, filePath);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {
      // The rename normally consumed the temporary file.
    }
  }
}
