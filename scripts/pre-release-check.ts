import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import {
  SKILL_CREATOR_TEMPLATE_CONTRACTS,
  validateTemplateContract,
} from './lib/templateContract.js'
import { evaluatePublishedVersionReadiness } from './lib/releaseReadiness.js'

function run(command: string): string {
  try {
    return execSync(command, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
    })
  } catch (error) {
    const commandError = error as {
      stdout?: string | Buffer
      stderr?: string | Buffer
      status?: number
    }
    const stdout = String(commandError.stdout ?? '').trim()
    const stderr = String(commandError.stderr ?? '').trim()
    const details = [
      `Command failed: ${command}`,
      commandError.status != null ? `Exit code: ${commandError.status}` : undefined,
      stdout ? `STDOUT:\n${stdout}` : undefined,
      stderr ? `STDERR:\n${stderr}` : undefined,
    ]
      .filter(Boolean)
      .join('\n\n')

    throw new Error(details)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function runStep(stepLabel: string, action: () => void): void {
  console.log(`\n${stepLabel}`)
  action()
}

console.log('🔍 Pre-release validation started...\n')

try {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as {
    name: string
    version: string
    bin?: Record<string, string>
    scripts?: Record<string, string>
    repository?: {
      type?: string
      url?: string
    }
  }

  runStep('1️⃣ Checking package.json...', () => {
    console.log(`   ✅ Package: ${packageJson.name}@${packageJson.version}`)

    const requiredScripts = [
      'build',
      'cli',
      'test',
      'ts',
      'verify:workflow',
      'verify:installed',
      'verify:linked',
      'pre-release-check',
    ]
    for (const script of requiredScripts) {
      assert(packageJson.scripts?.[script], `Missing required script: ${script}`)
      console.log(`   ✅ Script: ${script}`)
    }

    assert(
      packageJson.bin?.['skill-creator'] === 'dist/cli.mjs',
      'The published skill-creator bin must point to dist/cli.mjs'
    )
    assert(
      packageJson.scripts?.cli === 'node dist/cli.mjs',
      'The local cli script must point to dist/cli.mjs'
    )
    assert(
      packageJson.repository?.url === 'git+https://github.com/jixoai/skill-creator.git',
      'repository.url must exactly match the trusted publishing GitHub repository URL'
    )
    console.log('   ✅ CLI entrypoints target the ESM build output')
  })

  runStep('2️⃣ Building project...', () => {
    run('pnpm build')
    assert(existsSync('dist'), 'dist directory not found after build')
    assert(existsSync('dist/cli.mjs'), 'CLI entry point not found at dist/cli.mjs')
    assert(existsSync('dist/index.mjs'), 'Library entry point not found at dist/index.mjs')
    console.log('   ✅ Build artifacts verified')
  })

  runStep('3️⃣ Verifying packaged CLI entrypoint...', () => {
    const cliHelp = run('pnpm cli --help')
    assert(cliHelp.includes('create-cc-skill'), 'cli help output is missing create-cc-skill')
    assert(cliHelp.includes('resolve-context7'), 'cli help output is missing resolve-context7')
    const cliVersion = run('node dist/cli.mjs --version').trim()
    assert(cliVersion === packageJson.version, 'packaged CLI version output does not match package.json')
    console.log('   ✅ Packaged CLI help works')
  })

  runStep('4️⃣ Verifying publish tarball...', () => {
    const packOutput = run('npm pack --dry-run')
    assert(packOutput.includes('dist/cli.mjs'), 'publish tarball is missing dist/cli.mjs')
    assert(packOutput.includes('dist/index.mjs'), 'publish tarball is missing dist/index.mjs')
    console.log('   ✅ Publish tarball contains built artifacts')
  })

  runStep('5️⃣ Checking templates...', () => {
    assert(existsSync('templates'), 'Templates directory not found')
    for (const contract of SKILL_CREATOR_TEMPLATE_CONTRACTS) {
      validateTemplateContract(contract)
      console.log(`   ✅ ${contract.label}`)
    }
  })

  runStep('6️⃣ Running test suite...', () => {
    run('pnpm test')
    console.log('   ✅ All tests passed')
  })

  runStep('7️⃣ Running type check...', () => {
    run('pnpm ts')
    console.log('   ✅ Type check passed')
  })

  runStep('8️⃣ Validating OpenSpec...', () => {
    run('openspec validate --all --strict')
    console.log('   ✅ OpenSpec validation passed')
  })

  runStep('9️⃣ Verifying real CLI workflow...', () => {
    run('pnpm verify:workflow')
    console.log('   ✅ Real CLI workflow passed')
  })

  runStep('🔟 Verifying installed CLI workflow...', () => {
    run('pnpm verify:installed')
    console.log('   ✅ Installed CLI workflow passed')
  })

  runStep('1️⃣1️⃣ Verifying linked CLI workflow...', () => {
    run('pnpm verify:linked')
    console.log('   ✅ Linked CLI workflow passed')
  })

  runStep('1️⃣2️⃣ Checking version status...', () => {
    const publishedVersion = run(`npm view ${packageJson.name} version`).trim()
    const result = evaluatePublishedVersionReadiness({
      packageName: packageJson.name,
      localVersion: packageJson.version,
      publishedVersion,
    })

    assert(result.ready, result.message)
    console.log(`   ✅ ${result.message}`)
  })

  console.log('\n✅ All checks passed! Ready for release.')
} catch (error) {
  console.error(
    '\n❌ Validation failed:',
    error instanceof Error ? error.message : String(error)
  )
  process.exit(1)
}
