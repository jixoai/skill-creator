/**
 * Main skill creator class
 */

import { join, resolve } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, chmodSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import type { CreateSkillOptions, CreateSkillResult } from '../types/index.js'
import { Config } from '../utils/config.js'
import { match } from 'ts-pattern'
import { rootResolver } from '../utils/path.js'

// Internal config interface used during skill creation
interface SkillCreateConfig {
  context7LibraryId?: string
}

export class SkillCreator {
  private templateDir: string

  constructor() {
    this.templateDir = rootResolver('templates')
  }

  async createSkill(options: CreateSkillOptions): Promise<CreateSkillResult> {
    const result: CreateSkillResult = {
      created: false,
      message: '',
    }

    try {
      // Create skill directory
      const skillDir = join(options.baseDir, options.skillDirname)

      if (existsSync(skillDir)) {
        const files = readdirSync(skillDir)
        // Filter out .gitkeep files
        const realFiles = files.filter((f) => f !== '.gitkeep')
        if (realFiles.length > 0 && !options.force) {
          result.message = `Skill directory already exists and is not empty: ${skillDir}`
          return result
        } else if (realFiles.length > 0 && options.force) {
          console.log(
            `⚠️  Skill directory exists, forcing overwrite of existing files: ${skillDir}`
          )
        }
      }

      mkdirSync(skillDir, { recursive: true })

      // Create directory structure
      this.createDirectoryStructure(skillDir)

      // Create SKILL.md from template
      await this.createSkillMdFromTemplate(skillDir, options)

      result.created = true
      result.skillPath = skillDir
      result.message = `Skill created successfully: ${skillDir}`

      return result
    } catch (error) {
      result.message = `Failed to create skill: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
      return result
    }
  }

  private createDirectoryStructure(skillDir: string): void {
    const dirs = [
      'assets/references/context7', // Base directory for all context7 projects
      'assets/references/user', // User-created content
      'assets/search', // Backend-neutral search runtime data
      'assets/logs', // Logs
    ]

    for (const dir of dirs) {
      const dirPath = join(skillDir, dir)
      mkdirSync(dirPath, { recursive: true })
      // Only add .gitkeep to empty directories that should exist
      writeFileSync(join(dirPath, '.gitkeep'), '')
    }
  }

  private async createSkillMdFromTemplate(
    skillDir: string,
    options: CreateSkillOptions
  ): Promise<void> {
    const templatePath = join(this.templateDir, 'SKILL.md')

    if (!existsSync(templatePath)) {
      throw new Error(`SKILL.md template not found at ${templatePath}`)
    }

    let templateContent = readFileSync(templatePath, 'utf-8')

    // Replace template variables with options data
    templateContent = templateContent.replace(/\{\{(.+?)\}\}/g, (_, key) => {
      key = key.trim().toLowerCase()
      return match(key)
        .with('name', () => options.skillName)
        .with(
          'description',
          () =>
            options.skillDescription ??
            `Specialized ${options.skillName} expert assistant providing comprehensive technical support`
        )
        .with('skill_path', () => skillDir)
        .otherwise(() => _)
    })

    writeFileSync(join(skillDir, 'SKILL.md'), templateContent)
  }
}
