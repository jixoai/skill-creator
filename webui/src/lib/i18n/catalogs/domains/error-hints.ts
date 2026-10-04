/**
 * 用户原始需求 [2026-10-05]（Owner 裁决，webui-i18n-bilingual task 4.5 δ 线）：
 * 「客观留存这个错误，是调试的关键，但是可以辅助一些 i18n 的比较宽泛的翻译」。
 * 正交意图：
 *   [1] errorHints 域词典（en/zh 键成对，keyof 校验齐全）：daemon 错误原文是
 *       唯一真相且永不丢弃（调试关键）；本域只提供按错误家族的宽泛人话提示，
 *       由分类器（lib/i18n/error-hints.ts）在展示层叠加渲染。
 */
export const errorHintsEn = {
  /** 权限家族：EACCES / EPERM / permission denied / access denied。 */
  "errorHints.permission":
    "Not enough permission to complete this operation. Check the read/write permissions of the target file or directory.",
  /** Git 家族：fatal: / authentication failed / clone / remote access。 */
  "errorHints.git":
    "A Git operation failed (clone, remote access, or authentication). Check the repository URL and credentials.",
  /** 连接断开家族：daemon 未连接 / connection closed / socket hang up。 */
  "errorHints.disconnected": "The connection to the local daemon is unavailable or was dropped.",
  /** 网络家族：ETIMEDOUT / ECONNREFUSED / fetch failed / DNS。 */
  "errorHints.network":
    "A network connection failed or timed out. Check your connection and retry.",
  /** 状态冲突家族：revision 冲突 / already exists / proposal stale。 */
  "errorHints.conflict":
    "The operation conflicts with the current state; the content may have changed elsewhere. Refresh and retry.",
  /** 解析/校验家族：JSON / parse / invalid frontmatter。 */
  "errorHints.invalidData": "The data could not be parsed or did not pass validation.",
  /** 不存在家族：ENOENT / not found / does not exist。 */
  "errorHints.notFound":
    "The requested file or entry does not exist; it may have been moved or deleted.",
  /** 磁盘 IO 家族：EIO / EROFS / ENOSPC / read-only filesystem。 */
  "errorHints.io":
    "A disk or filesystem read/write error occurred. Check storage space and file state.",
  /** 非法操作家族：INVALID_OPERATION / not allowed / unsupported。 */
  "errorHints.invalidOperation": "This operation is not allowed in the current state.",
  /** 服务不可用家族：UNAVAILABLE / shutting down / session expired。 */
  "errorHints.unavailable": "The service is temporarily unavailable. Try again shortly.",
  /** 取消/中止家族：aborted / cancelled。 */
  "errorHints.cancelled": "The operation was cancelled or aborted.",
} as const;

export const errorHintsZh: Record<keyof typeof errorHintsEn, string> = {
  "errorHints.permission": "没有足够的权限完成这个操作。请检查目标文件或目录的读写权限。",
  "errorHints.git": "Git 操作失败（克隆、访问远程仓库或身份验证）。请检查仓库地址与凭据。",
  "errorHints.disconnected": "与本地 daemon 的连接不可用或已断开。",
  "errorHints.network": "网络连接失败或超时。请检查网络后重试。",
  "errorHints.conflict": "操作与当前状态冲突，内容可能已在别处被修改。请刷新后重试。",
  "errorHints.invalidData": "数据无法解析或校验未通过。",
  "errorHints.notFound": "请求的文件或条目不存在，可能已被移动或删除。",
  "errorHints.io": "磁盘或文件系统读写失败。请检查存储空间与文件状态。",
  "errorHints.invalidOperation": "当前状态下不允许执行这个操作。",
  "errorHints.unavailable": "服务暂时不可用。请稍后重试。",
  "errorHints.cancelled": "操作已被取消或中止。",
};
