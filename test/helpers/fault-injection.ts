/**
 * 平台感知的持久化故障注入（Windows 实证 Q4 产物）。
 *
 * POSIX 用 chmod 0o500 收紧父目录（读写同时失败）；Windows 的 chmod 不改变
 * 所有者权限，改为把目标文件替换为同名目录——读取 EISDIR、原子 rename 落盘
 * EPERM/ENOTEMPTY，同一边界上产生同类的 hard error。
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
