import path, { join } from 'node:path'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { PackageUtils } from './package.js'

export interface SkillPackageMetadata {
  packageName?: string
  versionHint?: string
}

export function inferVersionHintFromSkillDirectory(skillDir: string): string | undefined {
  const skillDirName = path.basename(skillDir)
  const versionSeparator = skillDirName.lastIndexOf('@')

  if (versionSeparator <= 0 || versionSeparator === skillDirName.length - 1) {
    return undefined
  }

  return skillDirName.slice(versionSeparator + 1)
}

export function inferPackageMetadataFromSkill(skillDir: string): SkillPackageMetadata {
  const skillMdPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMdPath)) {
    return {}
  }

  const skillMdContent = readFileSync(skillMdPath, 'utf-8')
  const packageTagMatch = skillMdContent.match(
    /<skill-package\s+name="([^"]*)"\s+version="([^"]*)">\s*<\/skill-package>/
  )

  if (!packageTagMatch) {
    return {}
  }

  const [, packageName, versionHint] = packageTagMatch
  return {
    packageName: packageName || undefined,
    versionHint: versionHint || undefined,
  }
}

export function findSkillDirectoryByPackageMetadata(
  base: string,
  packageName: string
): string | undefined {
  if (!existsSync(base)) return undefined

  const dirs = readdirSync(base, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => join(base, dirent.name))

  for (const dir of dirs) {
    const metadata = inferPackageMetadataFromSkill(dir)
    if (metadata.packageName === packageName) {
      return dir
    }
  }

  return undefined
}

export function findSkillDirectoryByName(base: string, packageName: string): string | undefined {
  if (!existsSync(base)) return undefined

  const normalizedPackageName = PackageUtils.normalizePackageName(packageName)
  const dirs = readdirSync(base, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .filter((name) => name.toLowerCase().includes(normalizedPackageName))

  return dirs.length > 0 ? join(base, dirs[0]) : undefined
}

export function getSkillSearchBases(cwd: string = process.cwd()): string[] {
  return [join(cwd, '.claude', 'skills'), join(homedir(), '.claude', 'skills')]
}

export function resolveSkillDirectoryFromOptions(
  commandOptions: {
    pwd?: string
    package?: string
  },
  globalOptions: {
    pwd?: string
  },
  cwd: string = process.cwd()
): string {
  const pwd = commandOptions.pwd || globalOptions.pwd

  if (pwd) {
    return pwd
  }

  if (!commandOptions.package) {
    throw new Error('Could not find skill directory. Please provide --pwd or a valid --package.')
  }

  const searchBases = getSkillSearchBases(cwd)
  const metadataMatchedSkillDir =
    searchBases
      .map((base) => findSkillDirectoryByPackageMetadata(base, commandOptions.package as string))
      .find(Boolean) ?? undefined

  const skillDir =
    metadataMatchedSkillDir ||
    searchBases.map((base) => findSkillDirectoryByName(base, commandOptions.package as string)).find(Boolean)

  if (skillDir) {
    return skillDir
  }

  throw new Error('Could not find skill directory. Please provide --pwd or a valid --package.')
}
