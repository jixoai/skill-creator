import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync, readFileSync, readdirSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFile, execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { createTempDir, cleanupTempDir } from '../test-utils.js'

const execFileAsync = promisify(execFile)

function normalizeRealPath(target: string): string {
  return realpathSync.native?.(target) ?? realpathSync(target)
}

describe('Skill Creation Integration Tests', () => {
  let tempDir: string

  beforeAll(() => {
    execSync('pnpm build', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
    })
  }, 60_000)

  beforeEach(() => {
    tempDir = createTempDir('integration-test-')
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  describe('Full Skill Creation Workflow', () => {
    it('should create and use a complete skill following the new CLI structure', () => {
        const packageName = 'zod' // Using a real, simple package
        const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`

        // 1. Search for package
        const searchOutput = execSync(`${cliCmd} search ${packageName}`, { encoding: 'utf-8' })
        const searchResults = JSON.parse(searchOutput)
        expect(searchResults).toBeInstanceOf(Array)
        expect(searchResults.length).toBeGreaterThan(0)
        expect(searchResults[0].name).toBe(packageName)

        // 2. Get package info
        const getInfoOutput = execSync(`${cliCmd} get-info ${packageName}`, { encoding: 'utf-8' })
        const packageInfo = JSON.parse(getInfoOutput)
        expect(packageInfo.name).toBe(packageName)
        expect(packageInfo.skill_dir_name).toBeDefined()
        expect(packageInfo.version).toBeDefined()
        expect(packageInfo.repo).toBeDefined()

        const { skill_dir_name, version } = packageInfo
        const description = 'Zod is a TypeScript-first schema declaration and validation library.' // Mock description as it can be null
        const skillDir = join(tempDir, '.claude', 'skills', skill_dir_name)

        // 3. Create skill using new command format: skill-creator create-cc-skill --scope [current|user|auto] --name packageName --description "desc" skill_dir_name
        const createCommand = [
          cliCmd,
          'create-cc-skill',
          '--scope',
          'current',
          '--name',
          '"zod"',
          '--description',
          `"${description}"`,
          '--json',
          `"${skill_dir_name}"`,
        ].join(' ')

        // The create command needs to run from within the tempDir to pick up the current scope
        const createOutput = execSync(createCommand, {
          encoding: 'utf-8',
          cwd: tempDir,
        })
        const createPayload = JSON.parse(createOutput) as {
          skillPath: string
          requestedScope: string
          resolvedScope: string
          scopePath: string
          skillDirName: string
          skillName: string
          sourcePackageName: string
          sourcePackageVersionHint: string
          skillDescription: string
        }
        expect(createPayload.requestedScope).toBe('current')
        expect(createPayload.resolvedScope).toBe('current')
        expect(normalizeRealPath(createPayload.skillPath)).toBe(normalizeRealPath(skillDir))
        expect(createPayload.skillDirName).toBe(skill_dir_name)
        expect(createPayload.skillName).toBe('zod')
        expect(createPayload.sourcePackageName).toBe('zod')

        expect(existsSync(skillDir)).toBe(true)

        // 4. Add documentation
        const addContent =
          "'# Zod Validation Guide\n\nZod is a TypeScript-first schema declaration and validation library. It provides powerful validation capabilities that make it easy to ensure data integrity in your applications. With Zod, you can define schemas and validate data against them with simple, intuitive syntax.'"
        const addCommand = `${cliCmd} add-skill --pwd "${skillDir}" --title "My Zod Note" --content ${addContent}`
        execSync(addCommand, { encoding: 'utf-8' })

        // 5. Search skill
        const searchSkillCommand = `${cliCmd} search-skill --pwd "${skillDir}" "validation"`
      const searchSkillOutput = execSync(searchSkillCommand, { encoding: 'utf-8' })
      expect(searchSkillOutput).toContain('Search Results')
      expect(searchSkillOutput).toContain('Requested mode: auto')
      expect(searchSkillOutput).toContain('Active backend: minisearch (auto)')
      expect(searchSkillOutput).toContain('Auto decision: Kept fulltext results')
      expect(searchSkillOutput).toContain('Zod Validation Guide')

        // 7. Verify file structure
        const expectedFiles = [
          'SKILL.md',
          'assets/references/context7/.gitkeep',
          'assets/references/user/.gitkeep',
          'assets/search/.gitkeep',
          'assets/logs/.gitkeep',
        ]

        expectedFiles.forEach((file) => {
          expect(existsSync(join(skillDir, file))).toBe(true)
        })

        // config.json and package.json should not exist anymore
        expect(existsSync(join(skillDir, 'config.json'))).toBe(false)
        expect(existsSync(join(skillDir, 'package.json'))).toBe(false)

        // scripts folder should not exist
        expect(existsSync(join(skillDir, 'scripts'))).toBe(false)
      }, 30_000)

    it('should download context7 docs, slice them, and persist search artifacts', async () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const skillDir = join(tempDir, '.claude', 'skills', 'downloaded-skill')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "downloaded-skill" --description "Download test skill" downloaded-skill`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      const server = createServer((request, response) => {
        if (request.url?.startsWith('/demo/pkg/llms.txt')) {
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
          response.end(`# Demo Package

Detailed overview content that is long enough to be preserved by the slicer and later indexed.

## Query Client

The query client coordinates caching, invalidation, and background refresh behavior for remote data.

## Mutations

Mutations should invalidate related queries and keep optimistic updates bounded to a clear owner.`)
          return
        }

        response.writeHead(404)
        response.end('not found')
      })

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const address = server.address()
      if (address == null || typeof address === 'string') {
        server.close()
        throw new Error('Failed to start test server')
      }

      try {
        await execFileAsync(
          'node',
          [`${process.cwd()}/dist/cli.mjs`, 'download-context7', '--pwd', skillDir, '/demo/pkg'],
          {
            env: {
              ...process.env,
              SKILL_CREATOR_CONTEXT7_BASE_URL: `http://127.0.0.1:${address.port}`,
            },
          }
        )

        const encodedProjectId = encodeURIComponent('/demo/pkg')
        const context7Dir = join(skillDir, 'assets', 'references', 'context7', encodedProjectId)
        expect(existsSync(context7Dir)).toBe(true)
        expect(readdirSync(context7Dir).some((file) => file.endsWith('.md'))).toBe(true)

        const skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')
        expect(skillMd).toContain(`<context7-skills id="/demo/pkg"`)
        expect(skillMd).toContain(`assets/references/context7/${encodedProjectId}`)
        expect(skillMd).toContain('<skill-package name="downloaded-skill" version="">')

        expect(existsSync(join(skillDir, 'assets', 'search', 'minisearch-index.json'))).toBe(true)
        expect(existsSync(join(skillDir, 'assets', 'search', 'index-state.json'))).toBe(true)

        const searchOutput = execSync(
          `${cliCmd} search-skill --pwd "${skillDir}" --mode fulltext "query client"`,
          {
            encoding: 'utf-8',
          }
        )
        expect(searchOutput).toContain('query client coordinates caching')
        expect(searchOutput).toContain(`assets/references/context7/${encodedProjectId}/`)
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      }
    }, 30_000)

    it('should resolve the best context7 project id for a package', async () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const output = execSync(`${cliCmd} resolve-context7 vitest --package-version 4.1.7`, {
        encoding: 'utf-8',
      })

      const resolved = JSON.parse(output)
      expect(resolved.packageName).toBe('vitest')
      expect(resolved.bestMatch.id).toBe('/vitest-dev/vitest')
      expect(resolved.bestMatch.matchKind).toBe('package-path')
    }, 30_000)

    it('should expose the real fuzzy fallback backend when auto mode rejects weak fulltext results', () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const skillDir = join(tempDir, '.claude', 'skills', 'auto-fallback-skill')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "auto-fallback-skill" --description "Auto fallback test skill" auto-fallback-skill`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      execSync(
        `${cliCmd} add-skill --pwd "${skillDir}" --title "Release Notes" --content "Packaging updates and changelog only."`,
        { encoding: 'utf-8' }
      )

      writeFileSync(
        join(skillDir, 'assets', 'references', 'user', 'query_client.md'),
        '# QC Guide\n\nCache invalidation guidance only.'
      )

      const output = execSync(`${cliCmd} search-skill --pwd "${skillDir}" "query client"`, {
        encoding: 'utf-8',
      })

      expect(output).toContain('Requested mode: auto')
      expect(output).toContain('Active backend: ufuzzy (auto)')
      expect(output).toContain('Auto decision: Fell back from fulltext to fuzzy')
      expect(output).toContain('Auto backend: ufuzzy')
      expect(output).toContain('QC Guide')
    }, 30_000)

    it('should resolve context7 automatically when download-context7 is called with --package only', async () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const skillDir = join(tempDir, '.claude', 'skills', 'auto-download-skill')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "auto-download-skill" --description "Auto download test skill" auto-download-skill`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      const server = createServer((request, response) => {
        if (request.url?.startsWith('/api/v2/libs/search')) {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          response.end(
            JSON.stringify({
              results: [
                {
                  id: '/demo/pkg',
                  title: 'Demo Package',
                  description: 'Repository docs',
                  totalSnippets: 42,
                  trustScore: 8.5,
                  benchmarkScore: 87,
                  versions: ['v1.0.0'],
                },
              ],
            })
          )
          return
        }

        if (request.url?.startsWith('/demo/pkg/llms.txt')) {
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
          response.end(`# Demo Package

Detailed overview content that is long enough to be preserved by the slicer and later indexed.

## Fake Timers

Use fake timers to control asynchronous test timing deterministically.`)
          return
        }

        response.writeHead(404)
        response.end('not found')
      })

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const address = server.address()
      if (address == null || typeof address === 'string') {
        server.close()
        throw new Error('Failed to start test server')
      }

      try {
        const { stdout: output } = await execFileAsync(
          'node',
          [
            `${process.cwd()}/dist/cli.mjs`,
            'download-context7',
            '--pwd',
            skillDir,
            '--package',
            'demo-pkg',
            '--package-version',
            '1.0.0',
          ],
          {
            encoding: 'utf-8',
            env: {
              ...process.env,
              SKILL_CREATOR_CONTEXT7_SEARCH_BASE_URL: `http://127.0.0.1:${address.port}/api/v2/libs/search`,
              SKILL_CREATOR_CONTEXT7_BASE_URL: `http://127.0.0.1:${address.port}`,
            },
          }
        )

        expect(output).toContain('Resolved Context7 ID: /demo/pkg')
        expect(output).toContain('Documentation downloaded and sliced')

        const encodedProjectId = encodeURIComponent('/demo/pkg')
        const context7Dir = join(skillDir, 'assets', 'references', 'context7', encodedProjectId)
        expect(existsSync(context7Dir)).toBe(true)
        expect(readdirSync(context7Dir).some((file) => file.endsWith('.md'))).toBe(true)
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      }
    }, 30_000)

    it('should resolve context7 automatically from skill metadata when only --pwd is provided', async () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const skillDir = join(tempDir, '.claude', 'skills', 'metadata-download-skill@1')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "@demo/pkg" --description "Metadata download skill" metadata-download-skill@1`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      const server = createServer((request, response) => {
        if (request.url?.startsWith('/api/v2/libs/search')) {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          response.end(
            JSON.stringify({
              results: [
                {
                  id: '/demo/pkg',
                  title: 'Demo Package',
                  description: 'Repository docs',
                  totalSnippets: 42,
                  trustScore: 8.5,
                  benchmarkScore: 87,
                  versions: ['v1.0.0'],
                },
              ],
            })
          )
          return
        }

        if (request.url?.startsWith('/demo/pkg/llms.txt')) {
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
          response.end(`# Demo Package

Detailed overview content that is long enough to be preserved by the slicer and later indexed.

## Metadata Resolution

The package metadata stored in the skill allows automatic Context7 resolution.`)
          return
        }

        response.writeHead(404)
        response.end('not found')
      })

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const address = server.address()
      if (address == null || typeof address === 'string') {
        server.close()
        throw new Error('Failed to start test server')
      }

      try {
        const { stdout: output } = await execFileAsync(
          'node',
          [`${process.cwd()}/dist/cli.mjs`, 'download-context7', '--pwd', skillDir],
          {
            encoding: 'utf-8',
            env: {
              ...process.env,
              SKILL_CREATOR_CONTEXT7_SEARCH_BASE_URL: `http://127.0.0.1:${address.port}/api/v2/libs/search`,
              SKILL_CREATOR_CONTEXT7_BASE_URL: `http://127.0.0.1:${address.port}`,
            },
          }
        )

        expect(output).toContain('Package: @demo/pkg')
        expect(output).toContain('Version hint: 1')
        expect(output).toContain('Resolved Context7 ID: /demo/pkg')

        const encodedProjectId = encodeURIComponent('/demo/pkg')
        const context7Dir = join(skillDir, 'assets', 'references', 'context7', encodedProjectId)
        expect(existsSync(context7Dir)).toBe(true)
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      }
    }, 30_000)

    it('should resolve scoped package skills through --package', () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const skillDir = join(tempDir, '.claude', 'skills', '@tanstack__react-query@5')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "@tanstack/react-query" --description "React Query skill" @tanstack__react-query@5`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      execSync(
        `${cliCmd} add-skill --pwd "${skillDir}" --title "Query Client" --content "The query client owns cache invalidation and request deduplication."`,
        { encoding: 'utf-8' }
      )

      const output = execSync(
        `${cliCmd} search-skill --package @tanstack/react-query "cache invalidation"`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      expect(output).toContain('Query Client')
    }, 30_000)

    it('should prefer skill-package metadata over directory-name matching for --package resolution', () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const exactSkillDir = join(tempDir, '.claude', 'skills', 'custom-react-query-skill@5')
      const misleadingSkillDir = join(tempDir, '.claude', 'skills', 'tanstack__react-query@5')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "@tanstack/react-query" --description "Exact package skill" custom-react-query-skill@5`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "tanstack__react-query" --description "Misleading directory skill" tanstack__react-query@5`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      execSync(
        `${cliCmd} add-skill --pwd "${exactSkillDir}" --title "Exact Match" --content "This content belongs to the package metadata match."`,
        { encoding: 'utf-8' }
      )

      execSync(
        `${cliCmd} add-skill --pwd "${misleadingSkillDir}" --title "Misleading Match" --content "This content only matches by directory name."`,
        { encoding: 'utf-8' }
      )

      const output = execSync(
        `${cliCmd} search-skill --package @tanstack/react-query "package metadata match"`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      expect(output).toContain('Exact Match')
      expect(output).not.toContain('Misleading Match')
    }, 30_000)

    it('should show enhanced preview line indexes without formatter debug comments', () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const skillDir = join(tempDir, '.claude', 'skills', 'preview-skill')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "preview-skill" --description "Preview test skill" preview-skill`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      execSync(
        `${cliCmd} add-skill --pwd "${skillDir}" --title "Preview Result" --content "# Preview Result\n\nLine two context.\nLine three signal."`,
        { encoding: 'utf-8' }
      )

      execSync(
        `${cliCmd} add-skill --pwd "${skillDir}" --title "Metadata Result" --content "This content should rank lower for the query."`,
        { encoding: 'utf-8' }
      )

      const output = execSync(`${cliCmd} search-skill --pwd "${skillDir}" "preview result"`, {
        encoding: 'utf-8',
      })

      expect(output).toContain('Preview Result')
      expect(output).toContain('Backend: minisearch')
      expect(output).toContain('Auto backend: minisearch')
      expect(output).toContain('Preview:')
      expect(output).toContain('Lines: 1,2,3')
      expect(output).not.toContain('<!-- Score:')
      expect(output).not.toContain('Enhanced分层判断')
    }, 30_000)

    it('should show calibrated similar-content output when add-skill detects an existing user note', () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const skillDir = join(tempDir, '.claude', 'skills', 'similar-output-skill')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "similar-output-skill" --description "Similar output test skill" similar-output-skill`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      execSync(
        `${cliCmd} add-skill --pwd "${skillDir}" --title "Zod Mini local note" --content "Zod mini should stay aligned with stringbool coercion conventions in user workflows."`,
        { encoding: 'utf-8' }
      )

      let output = ''
      try {
        output = execSync(
          `${cliCmd} add-skill --pwd "${skillDir}" --title "Zod Mini local note v2" --content "Zod mini should stay aligned with stringbool coercion conventions in user workflows."`,
          { encoding: 'utf-8', stdio: 'pipe' }
        )
      } catch (error) {
        output = String((error as { stdout?: string }).stdout ?? '')
      }

      expect(output).toContain('Existing content is comprehensive enough')
      expect(output).toContain('Similar content found:')
      expect(output).toMatch(/1\. \[\d+\.\d{2}\] Zod Mini local note/)
      expect(output).toContain('Source: user (primary)')
    }, 30_000)

    it('should treat same-title duplicate content as a knowledge duplicate instead of a raw file conflict', () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const skillDir = join(tempDir, '.claude', 'skills', 'same-title-duplicate-skill')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "same-title-duplicate-skill" --description "Same title duplicate skill" same-title-duplicate-skill`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      execSync(
        `${cliCmd} add-skill --pwd "${skillDir}" --title "Duplicate Title" --content "This content should be recognized as an existing knowledge note."`,
        { encoding: 'utf-8' }
      )

      let output = ''
      try {
        output = execSync(
          `${cliCmd} add-skill --pwd "${skillDir}" --title "Duplicate Title" --content "This content should be recognized as an existing knowledge note."`,
          { encoding: 'utf-8', stdio: 'pipe' }
        )
      } catch (error) {
        output = String((error as { stdout?: string }).stdout ?? '')
      }

      expect(output).toContain('Existing content is comprehensive enough')
      expect(output).toContain('Similar content found:')
      expect(output).not.toContain('File already exists:')
      expect(output).toContain('Source: user (primary)')
    }, 30_000)

    it('should let --force replace the closest existing user note even when the incoming title differs', () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const skillDir = join(tempDir, '.claude', 'skills', 'force-merge-skill')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "force-merge-skill" --description "Force merge skill" force-merge-skill`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      execSync(
        `${cliCmd} add-skill --pwd "${skillDir}" --title "Zod Mini local note" --content "Zod mini should stay aligned with stringbool coercion conventions in user workflows."`,
        { encoding: 'utf-8' }
      )

      const output = execSync(
        `${cliCmd} add-skill --pwd "${skillDir}" --title "Zod Mini replacement" --content "Zod mini guidance has been replaced with a more opinionated knowledge note." --force`,
        { encoding: 'utf-8' }
      )

      expect(output).toContain('Replaced existing knowledge note')
      expect(output).toContain('Source: user (primary)')

      const searchOutput = execSync(`${cliCmd} search-skill --pwd "${skillDir}" "opinionated knowledge note"`, {
        encoding: 'utf-8',
      })
      expect(searchOutput).toContain('Zod Mini replacement')
    }, 30_000)

    it('should append knowledge updates into a stable section when --force-append targets an existing user note', () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const skillDir = join(tempDir, '.claude', 'skills', 'force-append-merge-skill')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "force-append-merge-skill" --description "Force append merge skill" force-append-merge-skill`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      execSync(
        `${cliCmd} add-skill --pwd "${skillDir}" --title "Zod Mini local note" --content "Prefer zod mini in bundle-sensitive applications and document stringbool coercion conventions in the user layer."`,
        { encoding: 'utf-8' }
      )

      const output = execSync(
        `${cliCmd} add-skill --pwd "${skillDir}" --title "Zod Mini appendix" --content "Add a stricter local rule for stringbool coercion in zod mini workflows." --force-append`,
        { encoding: 'utf-8' }
      )

      expect(output).toContain('Appended content to existing knowledge note')
      expect(output).toContain('Source: user (primary)')

      const userFile = join(skillDir, 'assets', 'references', 'user', 'zod_mini_local_note.md')
      const fileContent = readFileSync(userFile, 'utf-8')
      expect(fileContent).toContain('# Zod Mini local note')
      expect(fileContent).toContain('## Knowledge updates')
      expect(fileContent).toContain('### Update 1: Zod Mini appendix')
      expect(fileContent).toContain(
        'Add a stricter local rule for stringbool coercion in zod mini workflows.'
      )
      expect(fileContent).not.toContain('\n---\n')

      const searchOutput = execSync(
        `${cliCmd} search-skill --pwd "${skillDir}" "stricter local rule for stringbool coercion"`,
        {
          encoding: 'utf-8',
        }
      )
      expect(searchOutput).toContain('Zod Mini local note')
      expect(searchOutput).toContain('Knowledge updates')
    }, 30_000)

    it('should persist user notes even when similar context7 content already exists', async () => {
      const cliCmd = `node "${process.cwd()}/dist/cli.mjs"`
      const skillDir = join(tempDir, '.claude', 'skills', 'zod-user-priority@4')

      execSync(
        `${cliCmd} create-cc-skill --scope current --name "zod" --description "Zod user priority skill" zod-user-priority@4`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
        }
      )

      const server = createServer((request, response) => {
        if (request.url?.startsWith('/api/v2/libs/search')) {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          response.end(
            JSON.stringify({
              results: [
                {
                  id: '/colinhacks/zod',
                  title: 'Zod',
                  description: 'Repository docs',
                  totalSnippets: 42,
                  trustScore: 9.6,
                  benchmarkScore: 89,
                  versions: ['v4.0.1'],
                },
              ],
            })
          )
          return
        }

        if (request.url?.startsWith('/colinhacks/zod/llms.txt')) {
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
          response.end(`# Zod

## Zod Mini

Zod Mini provides a lightweight API surface for bundle-sensitive applications and schema-heavy projects.

## Coercion

Use stringbool when you need to coerce textual boolean values into booleans.`)
          return
        }

        response.writeHead(404)
        response.end('not found')
      })

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const address = server.address()
      if (address == null || typeof address === 'string') {
        server.close()
        throw new Error('Failed to start test server')
      }

      try {
        await execFileAsync(
          'node',
          [
            `${process.cwd()}/dist/cli.mjs`,
            'download-context7',
            '--pwd',
            skillDir,
            '--package',
            'zod',
            '--package-version',
            '4.4.3',
          ],
          {
            encoding: 'utf-8',
            env: {
              ...process.env,
              SKILL_CREATOR_CONTEXT7_SEARCH_BASE_URL: `http://127.0.0.1:${address.port}/api/v2/libs/search`,
              SKILL_CREATOR_CONTEXT7_BASE_URL: `http://127.0.0.1:${address.port}`,
            },
          }
        )

        execSync(
          `${cliCmd} add-skill --pwd "${skillDir}" --title "Zod Mini local note" --content "Prefer zod mini in bundle-sensitive applications and document stringbool coercion conventions in the user layer."`,
          { encoding: 'utf-8' }
        )

        const userDir = join(skillDir, 'assets', 'references', 'user')
        expect(readdirSync(userDir).some((file) => file.endsWith('.md'))).toBe(true)

        const output = execSync(
          `${cliCmd} search-skill --pwd "${skillDir}" "stringbool coercion conventions"`,
          {
            encoding: 'utf-8',
          }
        )

        expect(output).toContain('Zod Mini local note')
        const scoreMatches = [...output.matchAll(/\[Score: (\d+\.\d{2})\]/g)]
        expect(scoreMatches.length).toBeGreaterThanOrEqual(2)
        const topScore = Number(scoreMatches[0]?.[1] ?? 0)
        const secondScore = Number(scoreMatches[1]?.[1] ?? 0)
        expect(topScore).toBeGreaterThanOrEqual(75)
        expect(topScore).toBeGreaterThan(secondScore)
        expect(output).toContain('Source: user (primary)')
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      }
    }, 30_000)
  })

  describe('Error Cases', () => {
    it('should fail get-info for an invalid package', async () => {
      const server = createServer((_, response) => {
        response.setHeader('connection', 'close')
        response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: 'not found' }))
      })

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const address = server.address()
      if (address == null || typeof address === 'string') {
        server.close()
        throw new Error('Failed to start registry test server')
      }

      try {
        await expect(
          execFileAsync(
            'node',
            [`${process.cwd()}/dist/cli.mjs`, 'get-info', 'invalid-nonexistent-package-123'],
            {
              encoding: 'utf-8',
              env: {
                ...process.env,
                SKILL_CREATOR_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${address.port}/registry`,
              },
            }
          )
        ).rejects.toMatchObject({
          stderr: expect.stringContaining('not found or API error occurred'),
        })
      } finally {
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      }
    }, 15_000)

    it('should fail create-cc-skill without required options', () => {
      const command = `node ${process.cwd()}/dist/cli.mjs create-cc-skill my-skill`
      try {
        execSync(command, { encoding: 'utf-8' })
        throw new Error('expected create-cc-skill to fail without --scope')
      } catch (error) {
        expect(error).toMatchObject({
          stderr: expect.stringContaining(
            'Error: --scope is required. Use --scope current, --scope user, or --scope auto.'
          ),
        })
      }
    })
  })

  describe('Force Option', () => {
    it('should fail when skill directory exists without force', () => {
      const tempDir = createTempDir('force-test-')
      const skillDir = join(tempDir, '.claude', 'skills', 'test-force-skill')

      // Create an existing skill directory with some content
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'existing-file.txt'), 'existing content')

      const command = `node ${process.cwd()}/dist/cli.mjs create-cc-skill --scope current test-force-skill`

      expect(() => {
        execSync(command, { encoding: 'utf-8', cwd: tempDir })
      }).toThrow('Skill directory already exists and is not empty')

      cleanupTempDir(tempDir)
    })

    it('should succeed when skill directory exists with force option', () => {
      const tempDir = createTempDir('force-test-')
      const skillDir = join(tempDir, '.claude', 'skills', 'test-force-skill')

      // Create an existing skill directory with some content
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'existing-file.txt'), 'existing content')

      const command = `node ${process.cwd()}/dist/cli.mjs create-cc-skill --scope current --force test-force-skill`
      const output = execSync(command, { encoding: 'utf-8', cwd: tempDir })

      expect(output).toContain('✅ Skill created successfully')
      expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
      expect(existsSync(join(skillDir, 'config.json'))).toBe(false)
      expect(existsSync(join(skillDir, 'package.json'))).toBe(false)
      // The existing file should still exist (we only overwrite our files)
      expect(existsSync(join(skillDir, 'existing-file.txt'))).toBe(true)

      cleanupTempDir(tempDir)
    })
  })

  describe('init-cc Command', () => {
    it('should install skill-creator as subagent', () => {
      const tempDir = createTempDir('init-test-')
      const agentsDir = join(tempDir, '.claude', 'agents')
      const skillCreatorFile = join(agentsDir, 'skill-creator.md')

      // Mock the home directory to use our temp directory
      const originalEnv = process.env.HOME
      process.env.HOME = tempDir

      const command = `node ${process.cwd()}/dist/cli.mjs init-cc`
      const output = execSync(command, { encoding: 'utf-8' })

      expect(output).toContain('✅ Skill-creator subagent installed successfully!')
      expect(output).toContain('📁 Installed scope: user')
      expect(existsSync(skillCreatorFile)).toBe(true)

      // Check that it's a proper markdown file with frontmatter
      const content = readFileSync(skillCreatorFile, 'utf-8')
      expect(content).toContain('---')
      expect(content).toContain('name: skill-creator')
      expect(content).toContain('skill-creator --help')
      expect(content).toContain('skill-creator resolve-context7 <package-name>')
      expect(content).not.toContain('{{DEFAULT_SCOPE}}')
      expect(content).not.toContain('mcp__context7__resolve-library-id')
      expect(content).not.toContain('node dist/cli.mjs search')

      // Restore original HOME
      process.env.HOME = originalEnv

      cleanupTempDir(tempDir)
    })

    it('should let init resolve --scope auto to current when the project already has a local subagent', () => {
      const tempDir = createTempDir('init-auto-current-')
      const agentsDir = join(tempDir, '.claude', 'agents')
      const skillCreatorFile = join(agentsDir, 'skill-creator.md')

      mkdirSync(agentsDir, { recursive: true })
      writeFileSync(skillCreatorFile, '# existing local install')

      const output = execSync(`node ${process.cwd()}/dist/cli.mjs init --scope auto`, {
        cwd: tempDir,
        encoding: 'utf-8',
      })

      expect(output).toContain('📁 Installed scope: current')
      expect(output).toContain('📦 Installing in current directory...')
      expect(readFileSync(skillCreatorFile, 'utf-8')).toContain('skill-creator --help')

      cleanupTempDir(tempDir)
    })

    it('should expose a working packaged CLI entrypoint through pnpm cli', () => {
      const output = execSync('pnpm cli --help', {
        cwd: process.cwd(),
        encoding: 'utf-8',
      })

      expect(output).toContain('Create claude-code-skills with documentation management')
      expect(output).toContain('create-cc-skill')
      expect(output).toContain('resolve-context7')
      expect(output).toContain('build-index')
    })

    it('should expose machine-readable create-cc-skill output via --json', () => {
      const tempDir = createTempDir('create-skill-json-')
      const output = execSync(
        `node ${process.cwd()}/dist/cli.mjs create-cc-skill --scope current --name "json-skill" --description "JSON contract skill" --json json-skill@1`,
        {
          cwd: tempDir,
          encoding: 'utf-8',
        }
      )

      const payload = JSON.parse(output) as {
        skillPath: string
        requestedScope: string
        resolvedScope: string
        scopePath: string
        skillDirName: string
        skillName: string
        sourcePackageName: string
        sourcePackageVersionHint: string
        skillDescription: string
      }

      expect(payload.requestedScope).toBe('current')
      expect(payload.resolvedScope).toBe('current')
      expect(payload.skillDirName).toBe('json-skill@1')
      expect(payload.skillName).toBe('json-skill')
      expect(payload.sourcePackageName).toBe('json-skill')
      expect(payload.skillDescription).toBe('JSON contract skill')
      expect(normalizeRealPath(payload.scopePath)).toBe(
        normalizeRealPath(join(tempDir, '.claude', 'skills'))
      )
      expect(normalizeRealPath(payload.skillPath)).toBe(
        normalizeRealPath(join(tempDir, '.claude', 'skills', 'json-skill@1'))
      )
      expect(existsSync(payload.skillPath)).toBe(true)

      cleanupTempDir(tempDir)
    })

    it('should let create-cc-skill separate visible skill name from source package identity', () => {
      const tempDir = createTempDir('create-skill-visible-name-')
      const output = execSync(
        `node ${process.cwd()}/dist/cli.mjs create-cc-skill --scope current --name "@tanstack/router" --skill-name "router-skill" --description "Router workflow skill" --json tanstack-router@1`,
        {
          cwd: tempDir,
          encoding: 'utf-8',
        }
      )

      const payload = JSON.parse(output) as {
        skillPath: string
        requestedScope: string
        resolvedScope: string
        scopePath: string
        skillDirName: string
        skillName: string
        sourcePackageName: string
        sourcePackageVersionHint: string
        skillDescription: string
      }

      expect(payload.requestedScope).toBe('current')
      expect(payload.resolvedScope).toBe('current')
      expect(payload.skillDirName).toBe('tanstack-router@1')
      expect(payload.skillName).toBe('router-skill')
      expect(payload.sourcePackageName).toBe('@tanstack/router')
      expect(payload.sourcePackageVersionHint).toBe('1')
      expect(normalizeRealPath(payload.skillPath)).toBe(
        normalizeRealPath(join(tempDir, '.claude', 'skills', 'tanstack-router@1'))
      )

      const skillMd = readFileSync(join(payload.skillPath, 'SKILL.md'), 'utf-8')
      expect(skillMd).toContain('# router-skill')
      expect(skillMd).toContain('<skill-package name="@tanstack/router" version="1">')

      cleanupTempDir(tempDir)
    })

    it('should resolve --scope auto to the default current scope when a local skill-creator agent exists', () => {
      const tempDir = createTempDir('create-skill-auto-scope-')
      mkdirSync(join(tempDir, '.claude', 'agents'), { recursive: true })
      writeFileSync(join(tempDir, '.claude', 'agents', 'skill-creator.md'), '# installed')

      const output = execSync(
        `node ${process.cwd()}/dist/cli.mjs create-cc-skill --scope auto --name "auto-skill" --description "Auto scope skill" --json auto-skill@1`,
        {
          cwd: tempDir,
          encoding: 'utf-8',
        }
      )

      const payload = JSON.parse(output) as {
        skillPath: string
        requestedScope: string
        resolvedScope: string
        scopePath: string
        skillDirName: string
        skillName: string
        sourcePackageName: string
        sourcePackageVersionHint: string
        skillDescription: string
      }

      expect(payload.requestedScope).toBe('auto')
      expect(payload.resolvedScope).toBe('current')
      expect(normalizeRealPath(payload.scopePath)).toBe(
        normalizeRealPath(join(tempDir, '.claude', 'skills'))
      )
      expect(normalizeRealPath(payload.skillPath)).toBe(
        normalizeRealPath(join(tempDir, '.claude', 'skills', 'auto-skill@1'))
      )

      cleanupTempDir(tempDir)
    })

    it('should describe knowledge-level merge semantics in add-skill help output', () => {
      const command = `node ${process.cwd()}/dist/cli.mjs add-skill --help`
      const output = execSync(command, { encoding: 'utf-8' })
      const normalizedOutput = output.replace(/\s+/g, ' ')

      expect(normalizedOutput).toContain('Replace the closest matching user knowledge note')
      expect(normalizedOutput).toContain(
        'Append content as a knowledge update in the closest matching user note'
      )
      expect(normalizedOutput).not.toContain(
        'Append content to existing file instead of creating new file'
      )
    })

    it('should expose build-index as a first-class CLI command', () => {
      const tempDir = createTempDir('build-index-help-')
      const skillDir = join(tempDir, '.claude', 'skills', 'build-index-skill')
      const userDir = join(skillDir, 'assets', 'references', 'user')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(
        join(userDir, 'note.md'),
        '# Build Index Note\n\nA standalone note for search indexing.\n'
      )

      const helpOutput = execSync(`node ${process.cwd()}/dist/cli.mjs build-index --help`, {
        encoding: 'utf-8',
      })
      expect(helpOutput).toContain('Build or refresh the local search index for a skill')

      const output = execSync(
        `node ${process.cwd()}/dist/cli.mjs build-index --pwd "${skillDir}"`,
        {
          encoding: 'utf-8',
        }
      )

      expect(output).toContain('Building search index')
      expect(output).toContain('Mode: auto')
      expect(output).toContain('Index built: 1 documents')
      expect(output).toContain('Search index ready')
      expect(existsSync(join(skillDir, 'assets', 'search', 'minisearch-index.json'))).toBe(true)

      cleanupTempDir(tempDir)
    })

    it('should acknowledge an explicit deterministic vector embedder for offline vector workflows', async () => {
      const tempDir = createTempDir('build-index-vector-deterministic-')
      const skillDir = join(tempDir, '.claude', 'skills', 'build-index-vector-skill')
      const userDir = join(skillDir, 'assets', 'references', 'user')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(
        join(userDir, 'workflow_note.md'),
        '# Workflow Canonical Note\n\nPrefer deterministic invalidation ownership for operational workflows.\n'
      )

      const runtimeProbe = execSync(
        "node -e \"Promise.all([import('node:sqlite'), import('sqlite-vec')]).then(()=>process.stdout.write('ok')).catch(()=>process.stdout.write('fail'))\"",
        {
          encoding: 'utf-8',
          cwd: process.cwd(),
        }
      ).trim()

      if (runtimeProbe !== 'ok') {
        cleanupTempDir(tempDir)
        return
      }

      const buildOutput = execSync(
        `node ${process.cwd()}/dist/cli.mjs build-index --pwd "${skillDir}" --mode vector --vector-embedder deterministic`,
        {
          encoding: 'utf-8',
        }
      )

      expect(buildOutput).toContain('Mode: vector')
      expect(buildOutput).toContain('Vector embedder: deterministic')
      expect(buildOutput).toContain('Active backend: sqlite-vec (vector)')

      const searchOutput = execSync(
        `node ${process.cwd()}/dist/cli.mjs search-skill --pwd "${skillDir}" --mode vector --vector-embedder deterministic "operational workflows"`,
        {
          encoding: 'utf-8',
        }
      )

      expect(searchOutput).toContain('Requested mode: vector')
      expect(searchOutput).toContain('Vector embedder: deterministic')
      expect(searchOutput).toContain('Workflow Canonical Note')

      cleanupTempDir(tempDir)
    }, 30_000)

    it('should reject fuzzy mode for standalone build-index execution', () => {
      const tempDir = createTempDir('build-index-fuzzy-')
      const skillDir = join(tempDir, '.claude', 'skills', 'build-index-fuzzy-skill')
      const userDir = join(skillDir, 'assets', 'references', 'user')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(join(userDir, 'note.md'), '# Fuzzy Note\n\nStandalone index test.\n')

      expect(() =>
        execSync(
          `node ${process.cwd()}/dist/cli.mjs build-index --pwd "${skillDir}" --mode fuzzy`,
          {
            encoding: 'utf-8',
            stdio: 'pipe',
          }
        )
      ).toThrow(/Fuzzy mode does not support standalone prebuilt indexes/)

      cleanupTempDir(tempDir)
    })

    it('should verify the real CLI workflow through the reusable verification script', () => {
      const output = execSync('pnpm verify:workflow', {
        cwd: process.cwd(),
        encoding: 'utf-8',
      })

      expect(output).toContain('1. init-cc')
      expect(output).toContain('2. init --scope auto')
      expect(output).toContain('3. search')
      expect(output).toContain('4. get-info')
      expect(output).toContain('5. create-cc-skill')
      expect(output).toContain('6. download-context7')
      expect(output).toContain('7. download-context7 --force')
      expect(output).toContain('8. add-skill')
      expect(output).toContain('9. add-skill --force-append')
      expect(output).toContain('10. add-skill --force via --package')
      expect(output).toContain('11. search-skill')
      expect(output).toContain('12. vector runtime contract')
      expect(output).toContain('CLI workflow verification passed')
    }, 30_000)

    it('should verify the installed CLI workflow through the reusable install verification script', () => {
      const output = execSync('pnpm verify:installed', {
        cwd: process.cwd(),
        encoding: 'utf-8',
      })

      expect(output).toContain('1. pack published-style tarball')
      expect(output).toContain('2. install packed binary into isolated prefix')
      expect(output).toContain('3. verify installed cli help')
      expect(output).toContain('4. verify installed cli workflow')
      expect(output).toContain('[installed] 1. init-cc')
      expect(output).toContain('[installed] 2. init --scope auto')
      expect(output).toContain('[installed] 3. search')
      expect(output).toContain('[installed] 11. search-skill')
      expect(output).toContain('[installed] 12. vector runtime contract')
      expect(output).toContain('Installed CLI verification passed')
    }, 180_000)

    it('should verify the linked CLI workflow through the reusable link verification script', () => {
      const output = execSync('pnpm verify:linked', {
        cwd: process.cwd(),
        encoding: 'utf-8',
      })

      expect(output).toContain('1. create isolated linked binary')
      expect(output).toContain('2. verify linked cli help')
      expect(output).toContain('3. verify linked cli workflow')
      expect(output).toContain('[linked] 1. init-cc')
      expect(output).toContain('[linked] 2. init --scope auto')
      expect(output).toContain('[linked] 11. search-skill')
      expect(output).toContain('[linked] 12. vector runtime contract')
      expect(output).toContain('Linked CLI verification passed')
    }, 60_000)
  })
})
