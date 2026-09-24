# Proposal: windows-test-debt

## Why

wiki-directory-standard 的 Windows 实机轮（docs/search-design.md §17）登记了
63 项非辖区既有失败。Owner 裁决「现在做」。诊断证实每族一个系统性根因
（macOS 全绿是 POSIX unlink/fsync 宽容的假象）。

## What Changes（六根因 → 六修复）

1. win32 目录 fsync 恒 EPERM（libuv O_DIRECTORY 只读句柄）：`fs-authority`
   新增 `isDirSyncPlatformCeiling` 在 syncDir 唯一边界吸收（NTFS 自带元数据
   日志；其它平台/错误码保持 fail-closed）；同时以 fd 锚定（reparse tag
   lstat + fd↔锚 inode 复验）补上 win32 不映射 O_NOFOLLOW 的真实缺口
   （备份 manifest 读写曾可被 symlink 穿透）。
2. Node 26 实验 webstorage 在 globalThis 预置惰性 localStorage，遮蔽 jsdom：
   vitest webui project setup 注入 Storage shim（旧 Node 零改动）。
3. `path.relative` 反斜杠泄进契约字段：repository-service 投影边界归一
   `toContractRelativePath`（双分隔符）。
4. dsh 上游按平台互斥 shell 行（bash/pwsh），我方禁用表错禁 pwsh：移除并
   放行两名（平台矩阵归上游）。
5. 源码态 daemon 在 Windows Bun 缺 node:sqlite：win32 的 .ts entry 改经
   `node --import tsx`。
6. steward relPath 契约拒绝自身 path.join 的反斜杠产物：组装边界显用 `/`
   （wiki-directory-standard 会话先行修复，并入本 change 收口）。

## 验收

Windows 全量 `npx pnpm@12.3.4 exec vitest run`：**145 文件 / 1347 测试
全绿 / 0 失败**（基线 74 failed）。全部根因均有平台无关回归钉。
