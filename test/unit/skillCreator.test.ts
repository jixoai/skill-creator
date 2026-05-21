import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { SkillCreator } from '../../src/core/skillCreator.js'
import { createTempDir, cleanupTempDir } from '../test-utils.js'

describe('SkillCreator', () => {
  let tempDir: string
  let skillCreator: SkillCreator

  beforeEach(() => {
    tempDir = createTempDir('skill-creator-test-')
    skillCreator = new SkillCreator()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  describe('createSkill', () => {
    it('should create a skill with default options', async () => {
      const options = {
        baseDir: tempDir,
        skillDirname: 'test-package@1.0.0',
        skillName: 'test-package',
      }

      const result = await skillCreator.createSkill(options)

      expect(result.created).toBe(true)
      expect(result.skillPath).toContain('test-package@1.0.0')
      expect(existsSync(result.skillPath!)).toBe(true)

      // Check required files and directories
      expect(existsSync(join(result.skillPath!, 'SKILL.md'))).toBe(true)
      expect(existsSync(join(result.skillPath!, 'assets'))).toBe(true)
      expect(existsSync(join(result.skillPath!, 'assets', 'references'))).toBe(true)
      expect(existsSync(join(result.skillPath!, 'assets', 'references', 'context7'))).toBe(true)
      expect(existsSync(join(result.skillPath!, 'assets', 'references', 'user'))).toBe(true)
      expect(existsSync(join(result.skillPath!, 'assets', 'search'))).toBe(true)
      expect(existsSync(join(result.skillPath!, 'assets', 'logs'))).toBe(true)

      // Should not create config.json or package.json
      expect(existsSync(join(result.skillPath!, 'config.json'))).toBe(false)
      expect(existsSync(join(result.skillPath!, 'package.json'))).toBe(false)
      expect(existsSync(join(result.skillPath!, 'scripts'))).toBe(false)
    })

    it('should create skill with custom options', async () => {
      const options = {
        baseDir: tempDir,
        skillDirname: 'tanstack-router@1.2.3',
        skillName: '@tanstack/router',
        skillDescription: 'Custom description for TanStack Router',
      }

      const result = await skillCreator.createSkill(options)

      expect(result.created).toBe(true)
      expect(result.skillPath).toContain('tanstack-router@1.2.3')

      // Check SKILL.md content
      const skillMdPath = join(result.skillPath!, 'SKILL.md')
      const skillContent = readFileSync(skillMdPath, 'utf-8')
      expect(skillContent).toContain('@tanstack/router')
      expect(skillContent).toContain('Custom description for TanStack Router')
    })

    it('should handle storage in user directory', async () => {
      const userDir = join(homedir(), '.claude', 'skills')
      const options = {
        baseDir: userDir,
        skillDirname: 'user-skill@1.0.0',
        skillName: 'user-skill',
      }

      const result = await skillCreator.createSkill(options)

      expect(result.created).toBe(true)
      expect(result.skillPath).toContain(userDir)
      expect(result.skillPath).toContain('user-skill@1.0.0')

      // Clean up created skill
      rmSync(result.skillPath!, { recursive: true, force: true })
    }, 10000)

    it('should reject if directory exists and is not empty', async () => {
      const skillDir = join(tempDir, 'existing-skill@1.0.0')
      const options = {
        baseDir: tempDir,
        skillDirname: 'existing-skill@1.0.0',
        skillName: 'existing-skill',
      }

      // Create the directory with a file
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'existing.txt'), 'exists')

      const result = await skillCreator.createSkill(options)

      expect(result.created).toBe(false)
      expect(result.message).toContain('already exists and is not empty')
    })

    it('should create correct directory structure', async () => {
      const options = {
        baseDir: tempDir,
        skillDirname: 'test-structure@1.0.0',
        skillName: 'test-structure',
      }

      const result = await skillCreator.createSkill(options)
      const skillDir = result.skillPath!

      // Check directory structure
      const expectedDirs = [
        'assets/references/context7',
        'assets/references/user',
        'assets/search',
        'assets/logs',
      ]

      expectedDirs.forEach((dir) => {
        const dirPath = join(skillDir, dir)
        expect(existsSync(dirPath)).toBe(true)
        // Check that .gitkeep files are created
        expect(existsSync(join(dirPath, '.gitkeep'))).toBe(true)
      })

      // Should not create scripts folder
      expect(existsSync(join(skillDir, 'scripts'))).toBe(false)
    })

    it('should create proper SKILL.md content with template variables', async () => {
      const options = {
        baseDir: tempDir,
        skillDirname: 'test-template@1.0.0',
        skillName: 'test-template',
        skillDescription: 'Test template skill for documentation',
      }

      const result = await skillCreator.createSkill(options)
      const skillMdPath = join(result.skillPath!, 'SKILL.md')
      const content = readFileSync(skillMdPath, 'utf-8')

      // Check template variable replacement
      expect(content).toContain('# test-template') // Check H1 title
      expect(content).toContain('Test template skill for documentation')
      expect(content).toContain('skill-creator add-skill --pwd') // Check CLI commands section
      expect(content).toContain('--force')
      expect(content).toContain('--force-append')
      expect(content).toContain('<skill-package name="test-template" version="1.0.0">')
      expect(content).toContain('<user-skills baseDir="assets/references/user">') // Check user skills tag with baseDir
      expect(content).toContain('## Context7 Documentation') // Check context7 section
      expect(content).toContain(result.skillPath) // {{SKILL_PATH}} should be replaced

      // Check that default description is used when none provided
      const optionsWithoutDesc = {
        baseDir: tempDir,
        skillDirname: 'no-desc@1.0.0',
        skillName: 'no-desc',
      }
      const resultWithoutDesc = await skillCreator.createSkill(optionsWithoutDesc)
      const contentWithoutDesc = readFileSync(
        join(resultWithoutDesc.skillPath!, 'SKILL.md'),
        'utf-8'
      )
      expect(contentWithoutDesc).toContain(
        'Specialized no-desc expert assistant providing comprehensive technical support'
      )
      expect(contentWithoutDesc).toContain('<skill-package name="no-desc" version="1.0.0">')
    })

    it('should preserve source package identity separately from the skill name', async () => {
      const options = {
        baseDir: tempDir,
        skillDirname: 'tanstack-router@1.2.3',
        skillName: 'router-skill',
        sourcePackageName: '@tanstack/router',
        sourcePackageVersionHint: '1',
      }

      const result = await skillCreator.createSkill(options)
      const content = readFileSync(join(result.skillPath!, 'SKILL.md'), 'utf-8')

      expect(content).toContain('# router-skill')
      expect(content).toContain('<skill-package name="@tanstack/router" version="1">')
    })

    it('should not create config.json file (as this is handled separately)', async () => {
      const options = {
        baseDir: tempDir,
        skillDirname: 'no-config@1.0.0',
        skillName: 'no-config',
      }

      const result = await skillCreator.createSkill(options)
      const configPath = join(result.skillPath!, 'config.json')

      // config.json should not be created by SkillCreator
      expect(existsSync(configPath)).toBe(false)
    })
  })

  describe('force option', () => {
    it('should succeed with force option when directory exists', async () => {
      const skillDir = join(tempDir, 'test-force@1.0.0')
      const options = {
        baseDir: tempDir,
        skillDirname: 'test-force@1.0.0',
        skillName: 'test-force',
        force: true,
      }

      // Create an existing directory with files
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'existing.txt'), 'existing content')

      const result = await skillCreator.createSkill(options)

      expect(result.created).toBe(true)
      expect(result.skillPath).toBe(skillDir)
      expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
      expect(existsSync(join(skillDir, 'assets'))).toBe(true)
      // The existing file should still exist (we only overwrite our files)
      expect(existsSync(join(skillDir, 'existing.txt'))).toBe(true)
    })

    it('should work with force on empty directory', async () => {
      const skillDir = join(tempDir, 'test-force-empty@1.0.0')
      const options = {
        baseDir: tempDir,
        skillDirname: 'test-force-empty@1.0.0',
        skillName: 'test-force-empty',
        force: true,
      }

      // Create an empty directory
      mkdirSync(skillDir, { recursive: true })

      const result = await skillCreator.createSkill(options)

      expect(result.created).toBe(true)
      expect(result.skillPath).toBe(skillDir)
      expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should handle file system errors gracefully', async () => {
      // Create options with invalid path that should cause an error
      const options = {
        baseDir: '/invalid/path/that/does/not/exist',
        skillDirname: 'test-error@1.0.0',
        skillName: 'test-error',
      }

      const result = await skillCreator.createSkill(options)

      // Should handle errors gracefully
      expect(result.created).toBe(false)
      expect(result.message).toContain('Failed to create skill')
    })

    it('should handle template with unicode and special characters', async () => {
      const options = {
        baseDir: tempDir,
        skillDirname: 'test-unicode@1.0.0',
        skillName: 'test-with-unicode-🚀-and-特殊字符',
        skillDescription: 'Test description with emoji 🚀 and Chinese characters 中文',
      }

      const result = await skillCreator.createSkill(options)

      expect(result.created).toBe(true)
      const skillMdPath = join(result.skillPath!, 'SKILL.md')
      const content = readFileSync(skillMdPath, 'utf-8')

      // Verify template handles unicode and special characters correctly
      expect(content).toContain('test-with-unicode-🚀-and-特殊字符')
      expect(content).toContain('Test description with emoji 🚀 and Chinese characters 中文')
      expect(content).toContain(result.skillPath) // Path replacement should work
    })
  })

  describe('edge cases', () => {
    it('should handle empty skill name', async () => {
      const options = {
        baseDir: tempDir,
        skillDirname: 'empty-name@1.0.0',
        skillName: '',
      }

      const result = await skillCreator.createSkill(options)

      expect(result.created).toBe(true)
      const skillMdPath = join(result.skillPath!, 'SKILL.md')
      const content = readFileSync(skillMdPath, 'utf-8')
      // Should use default description when name is empty
      expect(content).toContain(
        'Specialized  expert assistant providing comprehensive technical support'
      )
    })

    it('should handle very long skill names', async () => {
      const longName = 'a'.repeat(100)
      const options = {
        baseDir: tempDir,
        skillDirname: `${longName}@1.0.0`,
        skillName: longName,
      }

      const result = await skillCreator.createSkill(options)

      expect(result.created).toBe(true)
      const skillMdPath = join(result.skillPath!, 'SKILL.md')
      const content = readFileSync(skillMdPath, 'utf-8')
      expect(content).toContain(longName)
    })

    it('should handle special characters in skill name', async () => {
      const options = {
        baseDir: tempDir,
        skillDirname: 'special-chars@1.0.0',
        skillName: 'test-with-special_chars-and-123',
      }

      const result = await skillCreator.createSkill(options)

      expect(result.created).toBe(true)
      const skillMdPath = join(result.skillPath!, 'SKILL.md')
      const content = readFileSync(skillMdPath, 'utf-8')
      expect(content).toContain('test-with-special_chars-and-123')
    })
  })
})
