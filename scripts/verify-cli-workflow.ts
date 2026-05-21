import { createServer } from 'node:http'
import { execFile, execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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

async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const tempDir = createTempDir('skill-creator-workflow-')
  const skillDir = join(tempDir, '.claude', 'skills', 'workflow-skill@1')
  const originalHome = process.env.HOME
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

    response.writeHead(404)
    response.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (address == null || typeof address === 'string') {
    server.close()
    throw new Error('Failed to start verification server')
  }

  try {
    console.log('1. init-cc')
    process.env.HOME = tempDir
    const initOutput = await runCli(repoRoot, 'init-cc')
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

    console.log('2. create-cc-skill')
    const createOutput = await runCli(
      tempDir,
      'create-cc-skill',
      '--scope',
      'current',
      '--name',
      'demo-pkg',
      '--description',
      'Workflow verification skill',
      'workflow-skill@1'
    )
    assert(createOutput.includes('Skill created successfully'), 'create-cc-skill failed')
    assert(existsSync(skillDir), 'skill directory was not created')

    console.log('3. download-context7')
    const env = {
      ...process.env,
      SKILL_CREATOR_CONTEXT7_SEARCH_BASE_URL: `http://127.0.0.1:${address.port}/api/v2/libs/search`,
      SKILL_CREATOR_CONTEXT7_BASE_URL: `http://127.0.0.1:${address.port}`,
    }
    const downloadOutput = await runCli(
      tempDir,
      'download-context7',
      '--pwd',
      skillDir,
      '--package',
      'demo-pkg',
      '--package-version',
      '1.0.0',
      {
        env,
      }
    )
    assert(downloadOutput.includes('Resolved Context7 ID: /demo/pkg'), 'download-context7 did not resolve the package')
    assert(downloadOutput.includes('Documentation downloaded and sliced'), 'download-context7 did not finish')
    assert(directoryContainsText(context7Dir, 'background refresh behavior'), 'initial context7 slices missing expected text')

    console.log('4. download-context7 --force')
    context7Document = `# Demo Package

This overview is still long enough to be preserved by the slicer and indexed.

## Query Client

The query client now enforces stricter invalidation ownership across operational workflows.

## Coercion

Stringbool coercion rules should stay explicit inside local notes.`
    const forceDownloadOutput = await runCli(tempDir, 'download-context7', '--pwd', skillDir, '--force', {
      env,
    })
    assert(forceDownloadOutput.includes('Package: demo-pkg'), 'metadata-only download did not infer package metadata')
    assert(forceDownloadOutput.includes('Resolved Context7 ID: /demo/pkg'), 'force download did not re-resolve Context7')
    assert(
      directoryContainsText(context7Dir, 'stricter invalidation ownership'),
      'force download did not refresh context7 slices'
    )

    console.log('5. add-skill')
    await runCli(
      tempDir,
      'add-skill',
      '--pwd',
      skillDir,
      '--title',
      'Workflow local note',
      '--content',
      'Prefer local stringbool coercion guidance for bundle-sensitive applications.'
    )

    console.log('6. add-skill --force-append')
    const appendOutput = await runCli(
      tempDir,
      'add-skill',
      '--pwd',
      skillDir,
      '--title',
      'Workflow update',
      '--content',
      'Append a stricter coercion rule for operational workflows.',
      '--force-append'
    )
    assert(
      appendOutput.includes('Appended content to existing knowledge note'),
      'force-append did not append to the closest note'
    )

    const userFile = join(skillDir, 'assets', 'references', 'user', 'workflow_local_note.md')
    const userFileContent = readFileSync(userFile, 'utf-8')
    assert(userFileContent.includes('## Knowledge updates'), 'knowledge updates section missing')
    assert(userFileContent.includes('### Update 1: Workflow update'), 'update heading missing')

    console.log('7. add-skill --force via --package')
    const replaceOutput = await runCli(
      tempDir,
      'add-skill',
      '--package',
      'demo-pkg',
      '--title',
      'Workflow canonical note',
      '--content',
      'Prefer deterministic invalidation ownership for operational workflows.',
      '--force'
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

    console.log('8. search-skill')
    const searchOutput = await runCli(
      tempDir,
      'search-skill',
      '--package',
      'demo-pkg',
      'operational workflows'
    )
    assert(searchOutput.includes('Workflow canonical note'), 'search-skill did not find the replaced user note')
    assert(
      searchOutput.includes('deterministic invalidation ownership'),
      'search-skill preview did not surface the replaced note content'
    )

    console.log('\n✅ CLI workflow verification passed')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    process.env.HOME = originalHome
    cleanupTempDir(tempDir)
  }
}

function directoryContainsText(dir: string, snippet: string): boolean {
  if (!existsSync(dir)) {
    return false
  }

  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .some((file) => readFileSync(join(dir, file), 'utf-8').includes(snippet))
}

async function runCli(
  cwd: string,
  ...args: [string, ...string[]]
): Promise<string>
async function runCli(
  cwd: string,
  ...argsAndOptions: [...string[], { env?: NodeJS.ProcessEnv }]
): Promise<string>
async function runCli(
  cwd: string,
  ...input: [...string[], { env?: NodeJS.ProcessEnv }?]
): Promise<string> {
  const maybeOptions = input.at(-1)
  const options =
    maybeOptions != null &&
    typeof maybeOptions === 'object' &&
    !Array.isArray(maybeOptions) &&
    'env' in maybeOptions ?
      maybeOptions
    : undefined
  const args = (options ? input.slice(0, -1) : input) as string[]
  const tsxCliPath = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const cliSourcePath = join(process.cwd(), 'src', 'cli.ts')
  const { stdout } = await execFileAsync('node', [tsxCliPath, cliSourcePath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: options?.env,
  })
  return stdout
}

await main()
