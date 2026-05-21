import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  const installRoot = createTempDir('skill-creator-install-')
  const installPrefix = join(installRoot, 'prefix')
  const packRoot = join(installRoot, 'pack')
  const installLog = join(installRoot, 'install.log')

  try {
    mkdirSync(packRoot, { recursive: true })

    console.log('1. pack published-style tarball')
    const { stdout: packStdout } = await execFileAsync(
      'npm',
      ['pack', '--json', '--pack-destination', packRoot],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
      }
    )
    const packResult = JSON.parse(packStdout) as Array<{ filename: string }>
    const tarballName = packResult[0]?.filename
    assert(tarballName != null, 'npm pack did not produce a tarball filename')
    const tarballPath = join(packRoot, tarballName)

    console.log('2. install packed binary into isolated prefix')
    const { stdout, stderr } = await execFileAsync(
      'npm',
      ['install', '-g', tarballPath, '--prefix', installPrefix],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
      }
    )
    writeFileSync(installLog, `${stdout}\n${stderr}`.trim())
    const commandPath = join(installPrefix, 'bin', 'skill-creator')

    console.log('3. verify installed cli help')
    const helpOutput = await createInstalledCliRunner(commandPath).run(repoRoot, ['--help'])
    assert(
      helpOutput.includes('Create claude-code-skills with documentation management'),
      'installed cli help header missing'
    )
    assert(
      helpOutput.includes('resolve-context7 [options] <package_name>'),
      'installed cli help missing resolve-context7'
    )

    console.log('4. verify installed cli workflow')
    await verifyCliWorkflow(createInstalledCliRunner(commandPath), {
      repoRoot,
      commandRoot: repoRoot,
      logPrefix: '[installed] ',
    })

    console.log('\n✅ Installed CLI verification passed')
  } finally {
    cleanupTempDir(installRoot)
  }
}

await main()
