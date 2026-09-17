/**
 * 用户原始需求 [2026-09-18]：「使用 ssh gaubeehonor 测试 Windows」——实测暴露
 * chmod 故障注入在 win32 对 owner 无效，本助手提供平台感知替代。
 * 正交意图：[1] 目标占位（目录替换）阻断读写；[2] 句柄保持阻断 rename 且保内容。
 */
/**
 * 平台感知的持久化故障注入（Windows 实证 Q4 产物）。
 *
 * POSIX 用 chmod 0o500 收紧父目录（读写同时失败）。Windows chmod 不改变所有者
 * 权限，提供两种注入：
 * - blockFileAccess/restoreFileAccess：目标路径替换为同名目录——读取 EISDIR、
 *   原子 rename EPERM/ENOTEMPTY；适合「目标尚不存在/内容无需保留」的场景。
 * - holdFileForBlockedWrite/releaseHeldFile：对既有文件保持打开句柄——
 *   Windows 语义下 rename 覆盖被打开文件抛 EPERM（探针实测），文件内容
 *   完整保留；适合断言「失败后原文件仍在」的场景。
 */
import fs from "node:fs";
import path from "node:path";

export function blockFileAccess(file: string): void {
  if (process.platform === "win32") {
    fs.rmSync(file, { force: true });
    fs.mkdirSync(file);
  } else {
    fs.chmodSync(path.dirname(file), 0o500);
  }
}

export function restoreFileAccess(file: string): void {
  if (process.platform === "win32") {
    fs.rmSync(file, { recursive: true, force: true });
  } else {
    fs.chmodSync(path.dirname(file), 0o700);
  }
}

const heldHandles = new Map<string, number>();

export function holdFileForBlockedWrite(file: string): void {
  if (process.platform === "win32") {
    heldHandles.set(file, fs.openSync(file, "r"));
  } else {
    fs.chmodSync(path.dirname(file), 0o500);
  }
}

export function releaseHeldFile(file: string): void {
  if (process.platform === "win32") {
    const fd = heldHandles.get(file);
    if (fd !== undefined) {
      fs.closeSync(fd);
      heldHandles.delete(file);
    }
  } else {
    fs.chmodSync(path.dirname(file), 0o700);
  }
}
