import { readFileSync } from 'node:fs'

export interface TemplateContract {
  label: string
  filePath: string
  requiredSnippets: string[]
  forbiddenSnippets: string[]
}

export const SKILL_CREATOR_TEMPLATE_CONTRACTS: TemplateContract[] = [
  {
    label: 'templates/skill-creator.md',
    filePath: 'templates/skill-creator.md',
    requiredSnippets: [
      'skill-creator --help',
      'skill-creator search "KEYWORDS"',
      'skill-creator get-info @package/name',
      'skill-creator create-cc-skill --scope [current|user] --name <package_name> skill_dir_name --description "..."',
      'skill-creator resolve-context7 <package-name> [--package-version <version>]',
      'skill-creator --pwd={skill_dir_fullpath} download-context7 {project-id}',
      'skill-creator --pwd={skill_dir_fullpath} download-context7 --package <package-name> [--package-version <version>]',
      'skill-creator --pwd={skill_dir_fullpath} download-context7',
      'skill-creator --pwd={skill_dir_fullpath} search-skill "test query"',
      'skill-creator build-index --pwd "{{SKILL_PATH}}" [--mode=auto|fulltext|vector]',
      "Follow order strictly",
    ],
    forbiddenSnippets: [
      '{{DEFAULT_SCOPE}}',
      'mcp__context7__resolve-library-id',
      'node dist/cli.mjs search',
      'node_modules/tsx/dist/cli.mjs',
    ],
  },
  {
    label: 'templates/skill-creator.zh-CN.md',
    filePath: 'templates/skill-creator.zh-CN.md',
    requiredSnippets: [
      'skill-creator --help',
      'skill-creator search "KEYWORDS"',
      'skill-creator get-info @package/name',
      'skill-creator create-cc-skill --scope [current|user] --name <package_name> skill_dir_name --description "..."',
      'skill-creator resolve-context7 <package-name> [--package-version <version>]',
      'skill-creator --pwd "{skill_dir_fullpath}" download-context7 {project-id}',
      'skill-creator --pwd "{skill_dir_fullpath}" download-context7 --package <package-name> [--package-version <version>]',
      'skill-creator --pwd "{skill_dir_fullpath}" download-context7',
      'skill-creator --pwd "{skill_dir_fullpath}" search-skill "test query"',
      'skill-creator build-index --pwd="{{SKILL_PATH}}" --mode=auto',
      '严格按照顺序执行',
    ],
    forbiddenSnippets: [
      '{{DEFAULT_SCOPE}}',
      'mcp__context7__resolve-library-id',
      'node dist/cli.mjs search',
      'node_modules/tsx/dist/cli.mjs',
    ],
  },
]

export function validateTemplateContract(contract: TemplateContract): void {
  const content = readFileSync(contract.filePath, 'utf-8')

  for (const snippet of contract.requiredSnippets) {
    if (!content.includes(snippet)) {
      throw new Error(`${contract.label} is missing required snippet: ${snippet}`)
    }
  }

  for (const snippet of contract.forbiddenSnippets) {
    if (content.includes(snippet)) {
      throw new Error(`${contract.label} still contains forbidden snippet: ${snippet}`)
    }
  }
}
