/**
 * SKILL.md tag management utilities
 * Manages <user-skills> and <context7-skills> tags in SKILL.md file
 */

import { readFileSync, writeFileSync } from 'node:fs'

export interface TagContent {
  tagName: string
  id?: string
  baseDir?: string
  content: string
  startIndex: number
  endIndex: number
}

export interface SkillPackageTag {
  name: string
  version: string
  startIndex: number
  endIndex: number
}

/**
 * Parse all tags from SKILL.md content
 */
export function parseSkillMdTags(content: string): TagContent[] {
  const tags: TagContent[] = []

  // Match <user-skills baseDir="...">...</user-skills>
  const userSkillsRegex = /<user-skills(?:\s+baseDir="([^"]+)")?>(\s[\s\S]*?)<\/user-skills>/g
  let match

  while ((match = userSkillsRegex.exec(content)) !== null) {
    tags.push({
      tagName: 'user-skills',
      baseDir: match[1] || 'assets/references/user', // Default baseDir
      content: match[2].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    })
  }

  // Match <context7-skills id="xxx" baseDir="...">...</context7-skills>
  const context7Regex =
    /<context7-skills\s+id="([^"]+)"(?:\s+baseDir="([^"]+)")?>(\s[\s\S]*?)<\/context7-skills>/g

  while ((match = context7Regex.exec(content)) !== null) {
    const projectId = match[1]
    tags.push({
      tagName: 'context7-skills',
      id: projectId,
      baseDir: match[2] || `assets/references/context7/${projectId}`, // Default baseDir with project ID
      content: match[3].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    })
  }

  return tags.sort((a, b) => a.startIndex - b.startIndex)
}

export function parseSkillPackageTag(content: string): SkillPackageTag | undefined {
  const match = content.match(
    /<skill-package\s+name="([^"]*)"\s+version="([^"]*)">\s*<\/skill-package>/
  )

  if (!match || match.index == null) {
    return undefined
  }

  const [, name, version] = match
  return {
    name,
    version,
    startIndex: match.index,
    endIndex: match.index + match[0].length,
  }
}

export function updateSkillPackageTag(
  content: string,
  metadata: {
    name: string
    version?: string
  }
): string {
  const existingTag = parseSkillPackageTag(content)
  if (!existingTag) {
    return content
  }

  const updatedTag = `<skill-package name="${metadata.name}" version="${metadata.version ?? ''}">\n</skill-package>`
  return content.slice(0, existingTag.startIndex) + updatedTag + content.slice(existingTag.endIndex)
}

/**
 * Update or create a tag in SKILL.md content
 */
export function updateSkillMdTag(
  content: string,
  tagName: 'user-skills' | 'context7-skills',
  newContent: string,
  id?: string,
  baseDir?: string
): string {
  const tags = parseSkillMdTags(content)

  // Find existing tag
  const existingTag = tags.find(
    (t) => t.tagName === tagName && (tagName === 'user-skills' || t.id === id)
  )

  if (existingTag) {
    // Replace existing tag content, preserving or updating baseDir
    const finalBaseDir = baseDir || existingTag.baseDir
    let tagStart: string
    if (tagName === 'user-skills') {
      tagStart = finalBaseDir ? `<user-skills baseDir="${finalBaseDir}">` : `<user-skills>`
    } else {
      tagStart = finalBaseDir
        ? `<context7-skills id="${id}" baseDir="${finalBaseDir}">`
        : `<context7-skills id="${id}">`
    }
    const tagEnd = `</${tagName}>`
    const newTag = `${tagStart}\n${newContent}\n${tagEnd}`

    return content.slice(0, existingTag.startIndex) + newTag + content.slice(existingTag.endIndex)
  } else if (tagName === 'context7-skills' && id) {
    // Add new context7-skills tag
    // Find the Context7 Documentation section
    const context7SectionRegex = /## Context7 Documentation[\s\S]*?(?=\n##|$)/
    const sectionMatch = content.match(context7SectionRegex)

    if (sectionMatch) {
      const sectionStart = content.indexOf(sectionMatch[0])
      const sectionEnd = sectionStart + sectionMatch[0].length

      // Find the end of existing context7-skills tags
      const existingContext7Tags = tags.filter((t) => t.tagName === 'context7-skills')
      let insertPosition = sectionEnd

      if (existingContext7Tags.length > 0) {
        const lastTag = existingContext7Tags[existingContext7Tags.length - 1]
        insertPosition = lastTag.endIndex
      } else {
        // Insert after the section header and comment
        const headerEnd = content.indexOf('\n', sectionStart + sectionMatch[0].indexOf('\n'))
        const commentEnd = content.indexOf('-->', headerEnd)
        insertPosition = commentEnd > headerEnd ? commentEnd + 3 : headerEnd
      }

      const finalBaseDir = baseDir || `assets/references/context7/${id}`
      const tagStart = finalBaseDir
        ? `<context7-skills id="${id}" baseDir="${finalBaseDir}">`
        : `<context7-skills id="${id}">`
      const newTag = `\n\n${tagStart}\n${newContent}\n</context7-skills>`

      return content.slice(0, insertPosition) + newTag + content.slice(insertPosition)
    }
  }

  return content
}

/**
 * Remove a context7-skills tag from SKILL.md
 */
export function removeContext7Tag(content: string, projectId: string): string {
  const tags = parseSkillMdTags(content)
  const tagToRemove = tags.find((t) => t.tagName === 'context7-skills' && t.id === projectId)

  if (!tagToRemove) {
    return content
  }

  // Remove the tag and any surrounding whitespace
  let startIndex = tagToRemove.startIndex
  let endIndex = tagToRemove.endIndex

  // Remove leading newlines
  while (startIndex > 0 && content[startIndex - 1] === '\n') {
    startIndex--
    if (startIndex > 0 && content[startIndex - 1] === '\n') break // Keep one newline
  }

  // Remove trailing newlines
  while (endIndex < content.length && content[endIndex] === '\n') {
    endIndex++
  }

  return content.slice(0, startIndex) + content.slice(endIndex)
}

/**
 * Get all context7 project IDs from SKILL.md
 */
export function getContext7ProjectIds(content: string): string[] {
  const tags = parseSkillMdTags(content)
  return tags.filter((t) => t.tagName === 'context7-skills' && t.id).map((t) => t.id as string)
}

/**
 * Get user skills files from SKILL.md
 */
export function getUserSkillsFiles(content: string): string[] {
  const tags = parseSkillMdTags(content)
  const userSkillsTag = tags.find((t) => t.tagName === 'user-skills')

  if (!userSkillsTag || !userSkillsTag.content) {
    return []
  }

  // Parse markdown list items
  return userSkillsTag.content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map((line) => line.slice(1).trim())
    .filter(Boolean)
}

/**
 * Get context7 files for a specific project from SKILL.md
 */
export function getContext7Files(content: string, projectId: string): string[] {
  const tags = parseSkillMdTags(content)
  const projectTag = tags.find((t) => t.tagName === 'context7-skills' && t.id === projectId)

  if (!projectTag || !projectTag.content) {
    return []
  }

  // Parse markdown list items
  return projectTag.content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map((line) => line.slice(1).trim())
    .filter(Boolean)
}

/**
 * Update SKILL.md file with new tag content
 */
export function updateSkillMdFile(
  filePath: string,
  tagName: 'user-skills' | 'context7-skills',
  newContent: string,
  id?: string,
  baseDir?: string
): void {
  const content = readFileSync(filePath, 'utf-8')
  const updated = updateSkillMdTag(content, tagName, newContent, id, baseDir)
  writeFileSync(filePath, updated, 'utf-8')
}

export function updateSkillPackageMetadataFile(
  filePath: string,
  metadata: {
    name: string
    version?: string
  }
): void {
  const content = readFileSync(filePath, 'utf-8')
  const updated = updateSkillPackageTag(content, metadata)
  writeFileSync(filePath, updated, 'utf-8')
}

/**
 * Remove context7 tag from SKILL.md file
 */
export function removeContext7TagFromFile(filePath: string, projectId: string): void {
  const content = readFileSync(filePath, 'utf-8')
  const updated = removeContext7Tag(content, projectId)
  writeFileSync(filePath, updated, 'utf-8')
}
