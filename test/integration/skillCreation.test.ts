import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFile, execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { createTempDir, cleanupTempDir } from '../test-utils.js'

const execFileAsync = promisify(execFile)

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

        // 3. Create skill using new command format: skill-creator create-cc-skill --scope [current|user] --name packageName --description "desc" skill_dir_name
        const createCommand = [
          cliCmd,
          'create-cc-skill',
          '--scope',
          'current',
          '--name',
          '"zod"',
          '--description',
          `"${description}"`,
          `"${skill_dir_name}"`,
        ].join(' ')

        // The create command needs to run from within the tempDir to pick up the current scope
        const createOutput = execSync(createCommand, {
          encoding: 'utf-8',
          cwd: tempDir,
        })
        expect(createOutput).toContain('✅ Skill created successfully:')

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
    it('should fail get-info for an invalid package', () => {
      const command = `node ${process.cwd()}/dist/cli.mjs get-info invalid-nonexistent-package-123`
      expect(() => execSync(command, { encoding: 'utf-8' })).toThrow()
    })

    it('should fail create-cc-skill without required options', () => {
      const command = `node ${process.cwd()}/dist/cli.mjs create-cc-skill my-skill`
      expect(() => execSync(command, { encoding: 'utf-8' })).toThrow()
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
  })
})
