import { createSourceCliRunner, verifyCliWorkflow } from './lib/workflowVerifier.js'

async function main(): Promise<void> {
  const repoRoot = process.cwd()
  await verifyCliWorkflow(createSourceCliRunner(repoRoot), {
    repoRoot,
  })
}

await main()
