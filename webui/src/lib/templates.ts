/**
 * 原始需求 [2026-07-14]：「引入对各行各业对 skills 的支持」。
 * 正交意图：
 * 1. 定义 Creator 可消费的模板模型。
 * 2. 提供覆盖多行业的内置 SKILL.md 半成品。
 */

/** Creator 内置技能模板。 */
export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** 模板正文（含占位符 {{like_this}}）。 */
  body: string;
  /** 占位符说明（key = 占位符名，value = 提示）。 */
  placeholders?: Record<string, string>;
}

/** 内置模板支持的行业分类。 */
export type TemplateCategory =
  | "coding"
  | "writing"
  | "data"
  | "design"
  | "devops"
  | "legal"
  | "general";

/** 模板分类的显示元数据。 */
export const TEMPLATE_CATEGORIES: Record<TemplateCategory, { label: string; icon: string }> = {
  coding: { label: "Coding", icon: "code" },
  writing: { label: "Writing", icon: "pen" },
  data: { label: "Data", icon: "database" },
  design: { label: "Design", icon: "palette" },
  devops: { label: "DevOps", icon: "server" },
  legal: { label: "Legal", icon: "scale" },
  general: { label: "General", icon: "box" },
};

/** Creator 提供的内置技能模板集合。 */
export const TEMPLATES: SkillTemplate[] = [
  {
    id: "code-review",
    name: "code-reviewer",
    description: "Review code changes for bugs, style, security, and best practices before merge.",
    category: "coding",
    body: `## When to Use

Use this skill when reviewing pull requests, code diffs, or staged changes. Focus on {{focus_areas}}.

## Review Checklist

1. **Correctness**: Does the code do what it claims? Check edge cases.
2. **Security**: Look for injection, auth bypass, secrets in code.
3. **Performance**: N+1 queries, unnecessary re-renders, large allocations.
4. **Readability**: Clear naming, appropriate comments, DRY without over-abstraction.

## Output Format

\`\`\`
LGTM | Request Changes
- [issue severity] file:line — description
- suggestion: concrete fix
\`\`\`

## Context

- Language: {{language}}
- Framework: {{framework}}
- Team conventions: {{conventions}}`,
    placeholders: {
      focus_areas: 'e.g. "security and performance"',
      language: "e.g. TypeScript",
      framework: "e.g. React",
      conventions: 'e.g. "use functional components, avoid any"',
    },
  },
  {
    id: "commit-writer",
    name: "commit-writer",
    description: "Generate clear, conventional commit messages from staged changes.",
    category: "coding",
    body: `## When to Use

Use this skill after staging changes, before committing. Analyze the diff and produce a commit message.

## Rules

1. Follow Conventional Commits: \`type(scope): description\`
2. Types: feat, fix, refactor, docs, test, chore, perf, ci
3. Description: imperative mood, lowercase, no period, max 72 chars
4. Body: explain *why*, not *what* (the diff shows what). Wrap at 80 chars.
5. Breaking change: add \`BREAKING CHANGE:\` footer.

## Example

\`\`\`
feat(auth): add OAuth2 token refresh middleware

Tokens expire after 1h. This adds automatic refresh on 401
responses, retrying the original request with the new token.

BREAKING CHANGE: authMiddleware now requires a tokenStore argument
\`\`\``,
  },
  {
    id: "test-generator",
    name: "test-generator",
    description: "Generate unit and integration tests from source code or function signatures.",
    category: "coding",
    body: `## When to Use

Use this skill to generate comprehensive test suites for functions, classes, or API endpoints.

## Strategy

1. **Happy path**: the most common valid input → expected output.
2. **Edge cases**: empty/null/undefined, boundary values, extreme sizes.
3. **Error cases**: invalid input, missing fields, permission denied.
4. **Integration**: interaction with dependencies (mock external calls).

## Test Framework

{{test_framework}}

## Naming

\`describe('ModuleName') → it('should verb when condition')\``,
    placeholders: {
      test_framework: "e.g. Vitest / Jest / Pytest",
    },
  },
  {
    id: "doc-writer",
    name: "api-doc-writer",
    description: "Generate clear API documentation from code, types, or OpenAPI specs.",
    category: "writing",
    body: `## When to Use

Generate or improve API documentation from code annotations, TypeScript types, or OpenAPI/Swagger specs.

## Structure

For each endpoint:
1. **Method + Path**: \`GET /api/v1/resource/{id}\`
2. **Summary**: one sentence.
3. **Parameters**: name, type, required, description.
4. **Responses**: status code, schema, example.
5. **Errors**: common error codes and meanings.

## Tone

- Precise, no filler. Every sentence conveys a fact a developer needs.
- Use code blocks for examples, not prose.
- Link to related endpoints with relative paths.`,
  },
  {
    id: "prd-writer",
    name: "prd-writer",
    description: "Draft Product Requirements Documents from feature descriptions or user stories.",
    category: "writing",
    body: `## When to Use

Transform a rough feature idea into a structured PRD for engineering, design, and stakeholders.

## PRD Sections

1. **Problem**: What user pain are we solving? Link to research/data.
2. **Goals / Non-goals**: What's in scope? What's explicitly out?
3. **User stories**: As a [role], I want [action], so that [benefit].
4. **Design**: UX flow, key screens, API changes, data model.
5. **Success metrics**: How do we know it worked? (adoption, retention, latency)
6. **Risks**: What could go wrong? Mitigation plan.
7. **Timeline**: Milestones, dependencies, launch plan.

## Context

- Product: {{product}}
- Target user: {{target_user}}`,
    placeholders: {
      product: 'e.g. "Skill Creator desktop app"',
      target_user: 'e.g. "developers using Claude Code"',
    },
  },
  {
    id: "data-analyst",
    name: "data-analyst",
    description: "Analyze datasets, generate insights, create visualizations, and build reports.",
    category: "data",
    body: `## When to Use

Use this skill for exploratory data analysis, statistical summaries, trend detection, and report generation.

## Workflow

1. **Profile**: shape, dtypes, missing values, unique counts.
2. **Distribution**: describe, histograms, outliers.
3. **Relationships**: correlation matrix, group-by comparisons.
4. **Insights**: anomalies, trends, segments worth investigating.
5. **Visualize**: choose chart type by question (comparison→bar, trend→line, distribution→hist, part-of-whole→pie).

## Tools

- Primary: {{analysis_tool}}
- Visualization: {{viz_tool}}

## Output

A markdown report with embedded charts, key findings in bullet points, and recommended next steps.`,
    placeholders: {
      analysis_tool: 'e.g. "pandas + Python"',
      viz_tool: 'e.g. "matplotlib / plotly"',
    },
  },
  {
    id: "design-system",
    name: "design-system-helper",
    description:
      "Enforce design system consistency: tokens, components, spacing, and accessibility.",
    category: "design",
    body: `## When to Use

Review UI code or designs for design system compliance. Catch inconsistencies in tokens, spacing, colors, typography.

## Checklist

1. **Tokens**: Use CSS variables / theme tokens, never hardcoded colors or sizes.
2. **Spacing**: Follow the 4px/8px grid. No arbitrary pixel values.
3. **Typography**: Use defined font scales. Check line-height and letter-spacing.
4. **Components**: Prefer existing components over custom HTML. If custom, document why.
5. **Accessibility**: WCAG AA contrast (4.5:1 text). Keyboard navigation. ARIA labels.
6. **Responsive**: Test at 360px, 768px, 1024px, 1440px breakpoints.

## Design System Reference

{{design_system_link}}`,
    placeholders: {
      design_system_link: 'e.g. "https://design.company.com/tokens"',
    },
  },
  {
    id: "ci-pipeline",
    name: "ci-pipeline-builder",
    description: "Design and validate CI/CD pipelines for build, test, deploy workflows.",
    category: "devops",
    body: `## When to Use

Create or review CI/CD pipeline configurations (GitHub Actions, GitLab CI, Jenkins).

## Pipeline Stages

1. **Lint**: format check, type check, lint. Fast, runs on every push.
2. **Test**: unit + integration. Parallelize by module/service.
3. **Build**: compile, bundle, docker image. Cache dependencies.
4. **Security**: dependency scan, SAST, secret detection.
5. **Deploy**: staging on main merge, production on tag/release.
6. **Notify**: status to Slack/Teams, deployment summary.

## Best Practices

- Fail fast: lint before test, test before build.
- Cache: node_modules, Docker layers, build artifacts.
- Secrets: use CI secrets, never commit.
- Matrix: test across {{matrix_versions}}.

## Platform

{{ci_platform}}`,
    placeholders: {
      matrix_versions: 'e.g. "Node 20, 22"',
      ci_platform: 'e.g. "GitHub Actions"',
    },
  },
  {
    id: "incident-response",
    name: "incident-responder",
    description: "Guide incident response: triage, mitigate, communicate, and postmortem.",
    category: "devops",
    body: `## When to Use

Active production incident. Follow this runbook to triage, stabilize, and document.

## Response Phases

### 1. Triage (first 5 min)
- Acknowledge alert. Assign Incident Commander (IC).
- Assess severity: SEV1 (down), SEV2 (degraded), SEV3 (minor).
- Open incident channel. Page on-call if needed.

### 2. Mitigate (next 30 min)
- Rollback recent deploys.
- Scale up resources.
- Disable problematic feature flags.
- **Do not fix root cause yet** — stabilize first.

### 3. Communicate
- Internal: incident channel every 15 min with status update.
- External: status page update for SEV1/SEV2.

### 4. Resolve & Postmortem
- Fix root cause.
- Write postmortem within 48h: timeline, impact, root cause, action items (with owners + dates).
- Schedule blameless review.

## escalation_policy

{{escalation_policy}}`,
    placeholders: {
      escalation_policy: 'e.g. "Page @oncall-primary, then @oncall-secondary after 5 min"',
    },
  },
  {
    id: "compliance-check",
    name: "compliance-checker",
    description: "Review documents or code for regulatory compliance (GDPR, HIPAA, SOC2).",
    category: "legal",
    body: `## When to Use

Check that documents, data flows, or code meet regulatory requirements before review by legal counsel.

## Compliance Framework

{{framework}}

## Checklist

1. **Data minimization**: Only collect data you need. Document purpose for each field.
2. **Consent**: Explicit opt-in for sensitive data. Audit trail of consent.
3. **Access control**: Role-based access. Principle of least privilege. Audit logs.
4. **Encryption**: At rest (AES-256) and in transit (TLS 1.2+).
5. **Retention**: Defined retention period. Automated deletion.
6. **Right to erasure**: User can request data deletion. Process documented.
7. **Breach notification**: Process to notify within {{breach_window}}.

## Disclaimer

This skill provides a preliminary check. **All findings must be reviewed by qualified legal counsel.** This is not legal advice.`,
    placeholders: {
      framework: 'e.g. "GDPR Article 5 & 32"',
      breach_window: 'e.g. "72 hours (GDPR)"',
    },
  },
  {
    id: "git-workflow",
    name: "git-workflow-assistant",
    description: "Guide git operations: branching, rebasing, conflict resolution, and cleanup.",
    category: "coding",
    body: `## When to Use

Help with complex git operations: interactive rebase, conflict resolution, branch management, history cleanup.

## Common Operations

### Rebase onto latest main
\`\`\`bash
git fetch origin
git rebase origin/main
# Resolve conflicts, then:
git rebase --continue
\`\`\`

### Squash commits before merge
\`\`\`bash
git rebase -i HEAD~3
# Change lines to "squash" or "fixup"
\`\`\`

### Resolve merge conflict
1. \`git status\` to see conflicted files.
2. Open each file, find \`<<<<<<<\` markers.
3. Choose/combine the changes.
4. \`git add <file>\` then \`git rebase --continue\` (or \`git merge --continue\`).

### Clean up branches
\`\`\`bash
git branch --merged main | grep -v main | xargs git branch -d
\`\`\`

## Branching Model

{{branching_model}}`,
    placeholders: {
      branching_model: 'e.g. "trunk-based (main + short-lived feature branches)"',
    },
  },
  {
    id: "meeting-notes",
    name: "meeting-summarizer",
    description: "Transform meeting transcripts into structured notes with action items.",
    category: "writing",
    body: `## When to Use

Process meeting transcripts or notes into a clean, actionable summary.

## Output Structure

### Meeting: [Title]
**Date**: [date] | **Attendees**: [names] | **Duration**: [min]

### Summary (2-3 sentences)
What was discussed and why it matters.

### Decisions
- Decision 1 (proposed by X, agreed by all)
- Decision 2

### Action Items
| Task | Owner | Due | Status |
|------|-------|-----|--------|
| ... | ... | ... | pending |

### Discussion Notes
- Topic A: key points, dissenting opinions.
- Topic B: ...

### Next Meeting
[Date/agenda if decided]`,
  },
];
