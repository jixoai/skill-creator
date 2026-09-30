/**
 * 用户原始需求 [2026-09-30]：「在启动 skill creator 的时候会在 ~/.agents/skills/
 * skill-creator-v2 这个目录提供一个 `Skill Creator V2` 的技能，目的是让其他的
 * Agent 也知道怎么通过 skill creator 去管理和搜索技能。这是一个闭环……原本我们
 * 内置到内部提示词的东西，现在直接和普通流程一样，也去读取全局的 Skill Creator
 * V2 就行。」
 *
 * 正交意图：
 *   [1] 产品自描述技能文档内容（SKILL.md + references/tools.md 文本与版本常量）：
 *       对外行为面（CLI + MCP readonly 工具）的单一事实投影。
 *   [2] boot 自举语义 ensureSelfSkill：缺失→写入；产品旧版→整组升级；用户内容/
 *       同版本→不触碰；IO 故障→typed 失败，绝不阻塞启动。
 *   [3] 根目录隔离阀：SKILL_CREATOR_SELF_SKILL_ROOT env / 显式参数（测试与探针
 *       绝不写真实 ~/.agents/skills）。
 * 妥协声明：文档以 TS 常量内嵌（esbuild 自动入包，不引入资产拷贝构建步）；
 * 所有权标记放 frontmatter（ccski 与 Creator 契约均 passthrough，未知键安全）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { safeParseExternal } from "../shared/external-input.js";
import { atomicWriteUtf8 } from "./path-safety.js";

/** 自举技能目录名（与 frontmatter name 一致，满足最严格的宿主校验）。 */
export const SELF_SKILL_DIRECTORY_NAME = "skill-creator-v2";
/** 所有权标记键值（frontmatter；区分产品内容与用户内容）。 */
const MANAGED_MARKER_KEY = "x-managed-by";
const MANAGED_MARKER_VALUE = "skill-creator";
/** 文档内容版本（只随对外行为面变化 bump，不随每个 patch 版本强制重写）。 */
export const SELF_SKILL_VERSION = "1";
/** 测试/探针隔离阀：覆盖全局技能根（缺省 ~/.agents/skills）。 */
export const SELF_SKILL_ROOT_ENV = "SKILL_CREATOR_SELF_SKILL_ROOT";

/** ensureSelfSkill 的闭合结果（typed；IO 故障不抛出）。 */
export type SelfSkillEnsureResult =
  | { kind: "installed" }
  | { kind: "updated"; fromVersion: string }
  | { kind: "current" }
  | { kind: "disabled" }
  | { kind: "foreign" }
  | { kind: "failed"; reason: string };

/** 现有文件 frontmatter 的标记字段收窄（外部输入：unknown → Zod；版本号容忍 YAML 数字）。 */
const MarkerSchema = z
  .object({
    [MANAGED_MARKER_KEY]: z.string().optional(),
    "x-managed-version": z.coerce.string().optional(),
  })
  .passthrough();

/** 解析现有 SKILL.md 文本的所有权标记；无 frontmatter / YAML 不可解析 → null（视为用户内容）。 */
function parseMarker(source: string): { managedByUs: boolean; version: string | null } | null {
  let document: ReturnType<typeof matter>;
  try {
    document = matter(source);
  } catch {
    return null;
  }
  const marker = safeParseExternal(MarkerSchema, document.data);
  if (!marker) return null;
  return {
    managedByUs: marker[MANAGED_MARKER_KEY] === MANAGED_MARKER_VALUE,
    version: marker["x-managed-version"] ?? null,
  };
}

/**
 * 自举技能的绝对目录：显式参数 > env 隔离阀 > `~/.agents/skills/skill-creator-v2`
 * （社区标准全局根；provider catalog 中 cline/dexto/kimi-code-cli/loaf/warp/zed
 * 等多个 Agent 的 globalPath 共享该根）。
 */
export function selfSkillDirectory(explicitRoot?: string): string {
  const root = explicitRoot ?? (process.env[SELF_SKILL_ROOT_ENV]?.trim() || "");
  if (root) return path.join(root, SELF_SKILL_DIRECTORY_NAME);
  return path.join(os.homedir(), ".agents", "skills", SELF_SKILL_DIRECTORY_NAME);
}

/**
 * 生产入口（main.ts）启动时调用：确保全局根下存在产品自描述技能。
 * 永不抛出——IO 故障收敛为 `{ kind: "failed" }` 由调用方记日志。
 *
 * 语义（design D2）：缺失 → 原子写入整组；产品旧版 → 整组升级；无标记 /
 * frontmatter 不可解析 / 同版本 → 不触碰（用户内容）；读/写 IO 硬错误 → failed。
 */
export function ensureSelfSkill(explicitRoot?: string): SelfSkillEnsureResult {
  const directory = selfSkillDirectory(explicitRoot);
  const skillFile = path.join(directory, "SKILL.md");
  let existing: string;
  try {
    existing = fs.readFileSync(skillFile, "utf8");
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      // 产品禁用语义 = SKILL.md rename 为 .SKILL.md（skill-service 同约定）：
      // 禁用痕迹在场时不重装——静默重装会让技能复活并进入 toggle conflict
      // 永久态（codex 复核 P1-1）。用户在 GUI 重新启用后恢复 current/upgrade 路径。
      if (fs.existsSync(path.join(directory, ".SKILL.md"))) return { kind: "disabled" };
      return writeSelfSkillSet(directory) ?? { kind: "installed" };
    }
    return { kind: "failed", reason: describeIo("read", skillFile, error) };
  }
  const marker = parseMarker(existing);
  if (!marker || !marker.managedByUs) return { kind: "foreign" };
  if (marker.version === SELF_SKILL_VERSION) return { kind: "current" };
  const fromVersion = marker.version ?? "";
  return writeSelfSkillSet(directory) ?? { kind: "updated", fromVersion };
}

/** 原子写整组文档；失败返回 typed failed（null = 写入成功）。 */
function writeSelfSkillSet(directory: string): SelfSkillEnsureResult | null {
  try {
    atomicWriteUtf8(path.join(directory, "SKILL.md"), selfSkillMarkdown());
    atomicWriteUtf8(path.join(directory, "references", "tools.md"), selfSkillToolsReference());
    return null;
  } catch (error) {
    return { kind: "failed", reason: describeIo("write", directory, error) };
  }
}

function describeIo(phase: "read" | "write", target: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `self-skill bootstrap ${phase} failed at ${target}: ${detail}`;
}

/** frontmatter 所有权块（内容与 MarkerSchema 对齐）。 */
function selfSkillFrontmatter(): string {
  return [
    "---",
    `name: ${SELF_SKILL_DIRECTORY_NAME}`,
    `description: ${SELF_SKILL_DESCRIPTION}`,
    `${MANAGED_MARKER_KEY}: ${MANAGED_MARKER_VALUE}`,
    `x-managed-version: "${SELF_SKILL_VERSION}"`,
    "---",
    "",
  ].join("\n");
}

/** 技能 description（单行 YAML；触发词面向各宿主的技能路由与 BM25 召回）。 */
const SELF_SKILL_DESCRIPTION =
  "本机 Agent 技能工作台 Skill Creator (V2) 的使用指南。当需要搜索/查找本机已安装技能（find/search skills）、读取技能全文、管理技能（安装/更新/启停/校验/清理重复）、维护 skill wiki，或用户提到 skill-creator / skill creator / 技能管理器 / skills manager / SKILL.md 管理时使用。两条通路：CLI（skill-creator search / wiki / mcp …）与只读 MCP 工具面（skills_search / skills_info / wiki_read …）；变更类操作一律经 Skill Creator GUI 人工审批。";

/** SKILL.md 正文（精炼决策面；完整目录在 references/tools.md）。 */
export function selfSkillMarkdown(): string {
  return `${selfSkillFrontmatter()}<!--
文件意图：本文件由 Skill Creator 产品自举写入（daemon 生产入口启动时 ensure），
是产品对外行为面（CLI + MCP readonly 工具）的文档投影；内容事实源在产品仓库
src/daemon/self-skill.ts，产品升级按 x-managed-version 整组刷新，人工修改会在
同版本内被保留（下个版本升级时覆盖）。
-->

# Skill Creator V2 — 本机技能管理与检索入口

Skill Creator 是本机的技能工作台：管理所有 Agent 的技能目录（发现 / 校验 / 启停 /
安装 / 更新 / 修订历史），并提供本地 BM25 检索与技能 wiki。本机全部技能按
Workspace（\`~\` = 全局聚合，或已导入的 ws_* 目录）→ Provider（claude-code / codex /
cursor / zcode 等 Agent 的 skills root）两层作用域组织。

## 通路选择

\`\`\`text
要做什么？
├─ 找技能 / 搜本机已装技能 ──────────> CLI: skill-creator search <query>
│                                      或 MCP: skills_search {query, limit?}
├─ 读某个技能的全文 / 校验它 ─────────> MCP: skills_search 拿 {workspaceId,
│                                      providerId, skillId} 三元组
│                                      → skills_info / skills_validate
├─ 列出本机有哪些 Workspace/Provider > MCP: workspace_list
├─ 装新技能 / 更新 / 启停 / 编辑 ─────> 引导用户在 GUI 操作（skill-creator start）；
│                                      读写面只读，mutation 需 GUI 人工审批
├─ 技能经验 / 认知碎片 wiki ──────────> CLI: skill-creator wiki <子命令>
│                                      或 MCP: wiki_scopes / wiki_list / wiki_read
└─ 结构化批量消费（推荐常驻）─────────> 注册 MCP: skill-creator mcp（stdio，只读）
\`\`\`

## 硬规则

- **只读面**：CLI/MCP 通路对技能数据只读；安装、更新、启停、编辑、删除都在
  Skill Creator GUI 内完成（\`skill-creator start\` 启动）——先向用户说明要做什么、
  影响哪些技能，再引导操作，不要声称"已修改"。
- **opaque id**：skillId（\`sk_*\`）与三元组由服务端签发，不要手工拼路径或猜测；
  永远先 \`skills_search\` / \`workspace_list\` 拿真 id。
- **搜索不需要 daemon**：\`skill-creator search\` 进程内完成（首次建索引稍慢）。

## 深入

完整 MCP 工具目录（含每个工具的输入形状）、CLI 全参考、Workspace/Provider 概念
与 MCP stdio 注册片段见 [references/tools.md](references/tools.md)。
`;
}

/** references/tools.md（完整目录；事实源 = src/cli/cli.ts 与 capability 登记）。 */
export function selfSkillToolsReference(): string {
  return `# Skill Creator 工具参考

事实源：CLI 帮助（\`skill-creator help\`）与产品 capability 登记表。工具名规则：
capability 名点号→下划线（\`skills.search\` → \`skills_search\`）。

## 概念模型

\`\`\`text
Workspace（作用域第一层）
  |-- "~"      Global Workspace：聚合所有 Agent 的全局 skills roots（只读消费）
  \`-- ws_*     Imported Workspace：已导入的本机目录（可写：创建/编辑/安装）
Provider = 一个 Workspace 内的 Agent skills root（providerId ∈ 社区 catalog：
  claude-code / codex / cursor / zcode / gemini-cli / warp / zed …）
技能身份 = { workspaceId, providerId, skillId(sk_*) } 三元组（服务端 opaque 签发）
\`\`\`

- Global（\`~\`）可发现/查看/校验/启停既有技能，但创建与安装目标只能是 Imported
  Workspace——装技能前先用 \`workspace_list\` 确认可写目标，没有就引导用户在 GUI
  导入目录。
- 同一技能可能出现在多个 provider root（内容重复）；\`skills_duplicates\` 给出
  contentHash 分组，去重决策留给用户。

## MCP 通路（结构化消费推荐）

注册 stdio server（readonly 面，不需要 daemon 常驻）：

\`\`\`json
{
  "mcpServers": {
    "skill-creator": { "command": "skill-creator", "args": ["mcp"] }
  }
}
\`\`\`

（各宿主的 MCP 配置位置不同：Claude Code \`claude mcp add skill-creator -- skill-creator mcp\`；
ZCode/Codex/其它宿主写各自 mcp 配置，命令同为 \`skill-creator mcp\`。）

### 只读工具目录（stdio / daemon 内同构）

| 工具 | 输入（JSON） | 用途 |
| --- | --- | --- |
| \`workspace_list\` | {} | 列 Workspace（含 provider roots 与计数） |
| \`skills_list\` | {workspaceId, providerId, includeDisabled?} | 列一个 provider 的技能 |
| \`skills_info\` | {workspaceId, providerId, skillId} | 读技能全文 + 元数据 |
| \`skills_validate\` | {workspaceId, providerId, skillId} | 校验技能结构/frontmatter |
| \`skills_search\` | {query, limit? (1-50, 默认 10)} | 跨全部 Workspace 的 BM25 检索 |
| \`skills_duplicates\` | {} | 内容重复技能分组 |
| \`skills_search_config_open\` | {} | 用系统编辑器打开检索排除配置 |
| \`skills_update_check\` | {workspaceId, providerId, skillIds?} | 对照上游 lock hash 的过期检查 |
| \`creator_load\` | {workspaceId, providerId, skillId} | 可编辑文档基线（含 revision） |
| \`creator_revisions\` | {workspaceId, providerId, skillId, limit? ≤100} | 修订历史（含 diff） |
| \`repository_scan\` | {source, ref?} | 浅克隆+钉 commit+扫描 Git 技能源 |
| \`repository_sources_list\` | {} | 列 curated/user 发现源（https Git） |
| \`wiki_scopes\` | {} | 列 wiki 作用域（global + 各 workspace） |
| \`wiki_list\` | {scope} | 列一个作用域的 pattern 碎片 |
| \`wiki_read\` | {scope, name} | 读一篇 pattern 全文 |
| \`wiki_distill_start\` | {source, limit? ≤100} | 蒸馏 run（需产品 agent 内核；独立 stdio 形态下 start 正常返回 runId，run 立即 failed(kernel-unavailable)，经 wiki_distill_status 可见） |
| \`wiki_distill_status\` | {runId} | 蒸馏 run 状态/提案台账 |
| \`wiki_distill_cancel\` | {runId} | 取消蒸馏 run |

变更类能力（安装/更新执行/启停/编辑/删除/写 wiki）在 MCP 面只有 \`*_propose\`
提案变体且仅存在于产品 GUI 的内置会话——外部 Agent 一律引导用户在 GUI 完成。

MCP resource 面：\`skill-creator://skill/{workspaceId}/{providerId}/{skillId}\`
（技能文档只读资源）。

## CLI 全参考

\`\`\`text
skill-creator start          Boot the daemon and open the tray window
skill-creator open           Show/focus the tray window of a running daemon
skill-creator openinbrowser  Open the running WebUI in the system browser
skill-creator status         Check the running daemon
skill-creator stop           Gracefully stop the daemon
skill-creator search         Search local skills (BM25 + skill tokenizer)
skill-creator wiki           Persistent agent-experience wiki
                             (list/show/add/find/edit/remove/log/impact/scopes/distill)
skill-creator mcp            Run the skill-creator MCP server over stdio (readonly face)
skill-creator version        Print the version
skill-creator help           Show this help
\`\`\`

### search 细节

\`\`\`bash
skill-creator search <query...> [--json] [--limit N]   # limit 1-50，默认 10
\`\`\`

- 进程内完成（不要求 daemon 在运行）；空 query 或 flag 解析失败 exit 1。
- \`--json\` 输出 \`{ "results": [...] }\`（每项主要字段：name/description/
  canonicalPath/score/installations/duplicates，另有 id/contentHash 等）；人读模式
  含路径与重复项。
- 中英混合 query 均可（tokenizer 含中文 bigram 与 Latin 标识符切分）。

### wiki 细节

\`skill-creator wiki <子命令>\` 进程内执行（\`distill\` 例外，走 daemon RPC）：
list/show/add/find/edit/remove/log/impact/scopes/distill。\`--workspace\` 支持
registry label/ws_id 或路径直传。wiki 目录 = \`<workspace>/.agents/skill-wiki/\`。

## 技能更新模型

skills-CLI（\`npx skills\`）安装的技能带 lock hash：\`skills_update_check\` 只读对比
上游；过期技能的执行重装（apply）在 GUI 完成（Repository 安装管线 + 校验链）。
手工放入的技能（投影为 installedVia: "unknown"、updatable: false）不参与 lock 对比。

## 安全与边界

- MCP/HTTP 面只监听 loopback；daemon WebUI token 不出本机。
- 不要绕过工具面直接读写技能文件来做"管理"——启停状态、revision 校验、安装验证
  都有服务端不变量，绕过会破坏它们。
`;
}
