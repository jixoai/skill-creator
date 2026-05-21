import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  createInstalledCliRunner,
  verifyCliWorkflow,
} from './lib/workflowVerifier.js'

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
  const linkRoot = createTempDir('skill-creator-link-')
  const linkPrefix = join(linkRoot, 'prefix')

  try {
    console.log('1. create isolated linked binary')
    await execFileAsync('npm', ['link'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      env: {
        ...process.env,
        npm_config_prefix: linkPrefix,
      },
    })

    const commandPath = join(linkPrefix, 'bin', 'skill-creator')
    assert(existsSync(commandPath), 'linked skill-creator binary was not created')

    console.log('2. verify linked cli help')
    const helpOutput = await createInstalledCliRunner(commandPath).run(repoRoot, ['--help'])
    assert(
      helpOutput.includes('Create claude-code-skills with documentation management'),
      'linked cli help header missing'
    )

    console.log('3. verify linked cli workflow')
    await verifyCliWorkflow(createInstalledCliRunner(commandPath), {
      repoRoot,
      commandRoot: repoRoot,
      logPrefix: '[linked] ',
    })

    console.log('\n✅ Linked CLI verification passed')
  } finally {
    cleanupTempDir(linkRoot)
  }
}

await main()
