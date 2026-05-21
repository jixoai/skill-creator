import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface WorkflowRunner {
  run(cwd: string, args: string[], options?: { env?: NodeJS.ProcessEnv }): Promise<string>
}

export interface WorkflowCommandError extends Error {
  stdout?: string
  stderr?: string
  exitCode?: number
}

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function asWorkflowCommandError(error: unknown): WorkflowCommandError {
  if (error instanceof Error) {
    return error as WorkflowCommandError
  }
  return new Error(String(error)) as WorkflowCommandError
}

function directoryContainsText(dir: string, snippet: string): boolean {
  if (!existsSync(dir)) {
    return false
  }

  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .some((file) => readFileSync(join(dir, file), 'utf-8').includes(snippet))
}

function normalizeRealPath(target: string): string {
  return realpathSync.native?.(target) ?? realpathSync(target)
}

export async function verifyCliWorkflow(
  runner: WorkflowRunner,
  options: {
    repoRoot: string
    commandRoot?: string
    logPrefix?: string
  }
): Promise<void> {
  const repoRoot = options.repoRoot
  const commandRoot = options.commandRoot ?? repoRoot
  const logPrefix = options.logPrefix ?? ''
  const tempDir = createTempDir('skill-creator-workflow-')
  const skillDir = join(tempDir, '.claude', 'skills', 'workflow-skill@1')
  const encodedProjectId = encodeURIComponent('/demo/pkg')
  const context7Dir = join(skillDir, 'assets', 'references', 'context7', encodedProjectId)
  let context7Document = `# Demo Package

This overview is long enough to be preserved by the slicer and indexed.

## Query Client

The query client coordinates caching, invalidation, and background refresh behavior for remote data.

## Coercion

Use stringbool coercion carefully and document the project-specific rule in user notes.`

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
              trustScore: 9.2,
              benchmarkScore: 88,
              versions: ['v1.0.0'],
            },
          ],
        })
      )
      return
    }

    if (request.url?.startsWith('/demo/pkg/llms.txt')) {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(context7Document)
      return
    }

    if (request.url?.startsWith('/registry/search')) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(
        JSON.stringify({
          objects: [
            {
              package: {
                name: 'demo-pkg',
                version: '1.0.0',
                description: 'Workflow verification package',
                date: '2026-05-21T00:00:00.000Z',
                publisher: {
                  username: 'workflow-bot',
                },
              },
              score: {
                detail: {
                  popularity: 0.95,
                },
              },
            },
          ],
        })
      )
      return
    }

    if (request.url === '/registry/demo-pkg/latest') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ version: '1.0.0' }))
      return
    }

    if (request.url === '/registry/demo-pkg') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(
        JSON.stringify({
          'dist-tags': {
            latest: '1.0.0',
          },
          versions: {
            '1.0.0': {
              name: 'demo-pkg',
              version: '1.0.0',
              description: 'Workflow verification package',
              homepage: 'https://example.com/demo-pkg',
              repository: {
                type: 'git',
                url: 'https://github.com/example/demo-pkg.git',
              },
            },
          },
        })
      )
      return
    }

    response.writeHead(404)
    response.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (address == null || typeof address === 'string') {
    server.close()
    throw new Error('Failed to start verification server')
  }

  const baseEnv = {
    ...process.env,
    HOME: tempDir,
    SKILL_CREATOR_CONTEXT7_SEARCH_BASE_URL: `http://127.0.0.1:${address.port}/api/v2/libs/search`,
    SKILL_CREATOR_CONTEXT7_BASE_URL: `http://127.0.0.1:${address.port}`,
    SKILL_CREATOR_NPM_SEARCH_BASE_URL: `http://127.0.0.1:${address.port}/registry/search`,
    SKILL_CREATOR_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${address.port}/registry`,
  }

  try {
    console.log(`${logPrefix}1. init-cc`)
    const initOutput = await runner.run(commandRoot, ['init-cc'], { env: baseEnv })
    assert(initOutput.includes('Skill-creator subagent installed successfully'), 'init-cc failed')
    const agentFile = join(tempDir, '.claude', 'agents', 'skill-creator.md')
    assert(existsSync(agentFile), 'init-cc did not create skill-creator.md')
    const agentContent = readFileSync(agentFile, 'utf-8')
    assert(!agentContent.includes('{{DEFAULT_SCOPE}}'), 'agent template still contains DEFAULT_SCOPE')
    assert(agentContent.includes('skill-creator --help'), 'agent template lost the stable CLI entrypoint')
    assert(
      agentContent.includes('skill-creator resolve-context7 <package-name>'),
      'agent template lost the built-in Context7 resolver step'
    )
    assert(
      !agentContent.includes('mcp__context7__resolve-library-id'),
      'agent template still references the legacy MCP resolver'
    )

    console.log(`${logPrefix}2. search`)
    const searchOutput = await runner.run(commandRoot, ['search', 'demo-pkg'], { env: baseEnv })
    assert(searchOutput.includes('"name": "demo-pkg"'), 'search did not return the mock package')

    console.log(`${logPrefix}3. get-info`)
    const getInfoOutput = await runner.run(commandRoot, ['get-info', 'demo-pkg'], { env: baseEnv })
    assert(getInfoOutput.includes('"skill_dir_name": "demo-pkg@1"'), 'get-info did not return normalized skill_dir_name')
    assert(getInfoOutput.includes('"homepage": "https://example.com/demo-pkg"'), 'get-info did not return homepage')

    console.log(`${logPrefix}4. create-cc-skill`)
    const createOutput = await runner.run(
      tempDir,
      [
        'create-cc-skill',
        '--scope',
        'current',
        '--name',
        'demo-pkg',
        '--description',
        'Workflow verification skill',
        '--json',
        'workflow-skill@1',
      ],
      { env: baseEnv }
    )
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
    assert(
      normalizeRealPath(createPayload.skillPath) === normalizeRealPath(skillDir),
      'create-cc-skill did not return the created skill path'
    )
    assert(createPayload.requestedScope === 'current', 'create-cc-skill did not return the requested scope')
    assert(createPayload.resolvedScope === 'current', 'create-cc-skill did not return the resolved scope')
    assert(createPayload.skillDirName === 'workflow-skill@1', 'create-cc-skill did not return the skill directory name')
    assert(createPayload.skillName === 'demo-pkg', 'create-cc-skill did not return the visible skill name')
    assert(createPayload.sourcePackageName === 'demo-pkg', 'create-cc-skill did not return the source package name')
    assert(existsSync(skillDir), 'skill directory was not created')

    console.log(`${logPrefix}5. download-context7`)
    const downloadOutput = await runner.run(
      tempDir,
      [
        'download-context7',
        '--pwd',
        skillDir,
        '--package',
        'demo-pkg',
        '--package-version',
        '1.0.0',
      ],
      { env: baseEnv }
    )
    assert(downloadOutput.includes('Resolved Context7 ID: /demo/pkg'), 'download-context7 did not resolve the package')
    assert(downloadOutput.includes('Documentation downloaded and sliced'), 'download-context7 did not finish')
    assert(directoryContainsText(context7Dir, 'background refresh behavior'), 'initial context7 slices missing expected text')

    console.log(`${logPrefix}6. download-context7 --force`)
    context7Document = `# Demo Package

This overview is still long enough to be preserved by the slicer and indexed.

## Query Client

The query client now enforces stricter invalidation ownership across operational workflows.

## Coercion

Stringbool coercion rules should stay explicit inside local notes.`
    const forceDownloadOutput = await runner.run(
      tempDir,
      ['download-context7', '--pwd', skillDir, '--force'],
      { env: baseEnv }
    )
    assert(forceDownloadOutput.includes('Package: demo-pkg'), 'metadata-only download did not infer package metadata')
    assert(forceDownloadOutput.includes('Resolved Context7 ID: /demo/pkg'), 'force download did not re-resolve Context7')
    assert(
      directoryContainsText(context7Dir, 'stricter invalidation ownership'),
      'force download did not refresh context7 slices'
    )

    console.log(`${logPrefix}7. add-skill`)
    await runner.run(
      tempDir,
      [
        'add-skill',
        '--pwd',
        skillDir,
        '--title',
        'Workflow local note',
        '--content',
        'Prefer local stringbool coercion guidance for bundle-sensitive applications.',
      ],
      { env: baseEnv }
    )

    console.log(`${logPrefix}8. add-skill --force-append`)
    const appendOutput = await runner.run(
      tempDir,
      [
        'add-skill',
        '--pwd',
        skillDir,
        '--title',
        'Workflow update',
        '--content',
        'Append a stricter coercion rule for operational workflows.',
        '--force-append',
      ],
      { env: baseEnv }
    )
    assert(
      appendOutput.includes('Appended content to existing knowledge note'),
      'force-append did not append to the closest note'
    )

    const userFile = join(skillDir, 'assets', 'references', 'user', 'workflow_local_note.md')
    const userFileContent = readFileSync(userFile, 'utf-8')
    assert(userFileContent.includes('## Knowledge updates'), 'knowledge updates section missing')
    assert(userFileContent.includes('### Update 1: Workflow update'), 'update heading missing')

    console.log(`${logPrefix}9. add-skill --force via --package`)
    const replaceOutput = await runner.run(
      tempDir,
      [
        'add-skill',
        '--package',
        'demo-pkg',
        '--title',
        'Workflow canonical note',
        '--content',
        'Prefer deterministic invalidation ownership for operational workflows.',
        '--force',
      ],
      { env: baseEnv }
    )
    assert(
      replaceOutput.includes('Replaced existing knowledge note'),
      'force replace did not target the closest user note'
    )

    const replacedFileContent = readFileSync(userFile, 'utf-8')
    assert(replacedFileContent.includes('# Workflow canonical note'), 'force replace did not rewrite the note title')
    assert(
      replacedFileContent.includes('Prefer deterministic invalidation ownership for operational workflows.'),
      'force replace did not rewrite the note content'
    )

    console.log(`${logPrefix}10. search-skill`)
    const searchSkillOutput = await runner.run(
      tempDir,
      ['search-skill', '--package', 'demo-pkg', 'operational workflows'],
      { env: baseEnv }
    )
    assert(searchSkillOutput.includes('Workflow canonical note'), 'search-skill did not find the replaced user note')
    assert(
      searchSkillOutput.includes('deterministic invalidation ownership'),
      'search-skill preview did not surface the replaced note content'
    )

    console.log(`${logPrefix}11. vector runtime contract`)
    const vectorRuntimeSupported = await detectVectorRuntimeSupport(baseEnv)

    if (vectorRuntimeSupported) {
      const buildIndexOutput = await runner.run(
        tempDir,
        ['build-index', '--pwd', skillDir, '--mode', 'vector', '--vector-embedder', 'deterministic'],
        { env: baseEnv }
      )
      assert(buildIndexOutput.includes('Mode: vector'), 'build-index did not acknowledge vector mode')
      assert(
        buildIndexOutput.includes('Vector embedder: deterministic'),
        'build-index did not acknowledge the explicit deterministic vector embedder'
      )
      assert(
        buildIndexOutput.includes('Active backend: sqlite-vec (vector)'),
        'build-index did not report sqlite-vec as the active vector backend'
      )

      const vectorSearchOutput = await runner.run(
        tempDir,
        [
          'search-skill',
          '--pwd',
          skillDir,
          '--mode',
          'vector',
          '--vector-embedder',
          'deterministic',
          'operational workflows',
        ],
        { env: baseEnv }
      )
      assert(
        vectorSearchOutput.includes('Vector embedder: deterministic'),
        'search-skill did not acknowledge the explicit deterministic vector embedder'
      )
      assert(
        vectorSearchOutput.includes('Workflow canonical note'),
        'vector search did not find the expected user note'
      )
    } else {
      try {
        await runner.run(tempDir, ['build-index', '--pwd', skillDir, '--mode', 'vector'], {
          env: baseEnv,
        })
        throw new Error('vector build-index unexpectedly succeeded without runtime support')
      } catch (error) {
        const commandError = asWorkflowCommandError(error)
        const output = `${commandError.stdout ?? ''}\n${commandError.stderr ?? ''}\n${commandError.message}`
        assert(
          output.includes('Vector mode is unavailable in this runtime'),
          'vector build-index did not explain the runtime support requirement'
        )
      }
    }

    console.log('\n✅ CLI workflow verification passed')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    cleanupTempDir(tempDir)
  }
}

async function detectVectorRuntimeSupport(env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'node',
      [
        '-e',
        "Promise.all([import('node:sqlite'), import('sqlite-vec')]).then(()=>process.stdout.write('ok')).catch(()=>process.stdout.write('fail'))",
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
        env,
      }
    )
    return stdout.trim() === 'ok'
  } catch {
    return false
  }
}

export function createSourceCliRunner(repoRoot: string): WorkflowRunner {
  return {
    async run(cwd, args, options) {
      const tsxCliPath = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
      const cliSourcePath = join(repoRoot, 'src', 'cli.ts')
      try {
        const { stdout } = await execFileAsync('node', [tsxCliPath, cliSourcePath, ...args], {
          cwd,
          encoding: 'utf-8',
          env: options?.env,
        })
        return stdout
      } catch (error) {
        const commandError = error as {
          stdout?: string | Buffer
          stderr?: string | Buffer
          status?: number
          message?: string
        }
        const wrapped = new Error(commandError.message ?? 'Command failed') as WorkflowCommandError
        wrapped.stdout = String(commandError.stdout ?? '')
        wrapped.stderr = String(commandError.stderr ?? '')
        wrapped.exitCode = commandError.status
        throw wrapped
      }
    },
  }
}

export function createInstalledCliRunner(commandPath: string): WorkflowRunner {
  return {
    async run(cwd, args, options) {
      try {
        const { stdout } = await execFileAsync(commandPath, args, {
          cwd,
          encoding: 'utf-8',
          env: options?.env,
        })
        return stdout
      } catch (error) {
        const commandError = error as {
          stdout?: string | Buffer
          stderr?: string | Buffer
          status?: number
          message?: string
        }
        const wrapped = new Error(commandError.message ?? 'Command failed') as WorkflowCommandError
        wrapped.stdout = String(commandError.stdout ?? '')
        wrapped.stderr = String(commandError.stderr ?? '')
        wrapped.exitCode = commandError.status
        throw wrapped
      }
    },
  }
}
