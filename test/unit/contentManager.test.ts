import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentManager } from '../../src/core/contentManager.js'
import { buildSearchEngine } from '../../src/core/searchEngineFactory.js'
import { createTempDir, cleanupTempDir } from '../test-utils.js'

// Mock search engine for testing
class MockSearchEngine {
  private documents: any[] = []

  async addDocuments(docs: any[]) {
    this.documents.push(...docs)
  }

  async search(query: string, topK: number = 5, where?: any): Promise<any[]> {
    let results = this.documents

    if (where?.source) {
      results = results.filter((doc) => doc.source === where.source)
    }

    // Simple mock search with realistic scores
    const queryLower = query.toLowerCase()
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 1) // Filter out very short words

    // Filter by checking if any query words match
    const filtered = results.filter((doc) => {
      const titleLower = doc.title.toLowerCase()
      const contentLower = doc.content.toLowerCase()

      // Check if any significant query words match
      return queryWords.some((word) => titleLower.includes(word) || contentLower.includes(word))
    })

    // Calculate scores based on content similarity
    return filtered
      .map((doc) => {
        // Calculate a simple similarity score
        const titleWords = doc.title.toLowerCase().split(/\s+/)
        const contentWords = doc.content.toLowerCase().split(/\s+/)

        // Title matching score
        const titleMatches = queryWords.filter((word) => titleWords.includes(word)).length
        const titleScore = titleMatches / Math.max(titleWords.length, 1)

        // Content matching score
        const contentMatches = queryWords.filter((word) => contentWords.includes(word)).length
        const contentScore = contentMatches / Math.max(queryWords.length, 1)

        // Combined score with title weight
        const combinedScore = titleScore * 0.3 + contentScore * 0.7
        const score = Math.min(combinedScore, 1.0)

        return {
          ...doc,
          score,
          file_path: `${doc.source}/${doc.filename}`, // Add file_path for ContentManager
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  async getStats() {
    return { totalDocuments: this.documents.length }
  }
}

describe('ContentManager', () => {
  let tempDir: string
  let referencesDir: string
  let mockSearchEngine: MockSearchEngine
  let contentManager: ContentManager

  beforeEach(() => {
    tempDir = createTempDir('content-manager-test-')
    referencesDir = join(tempDir, 'references')
    mkdirSync(referencesDir, { recursive: true })
    mkdirSync(join(referencesDir, 'user'), { recursive: true })
    mkdirSync(join(referencesDir, 'context7'), { recursive: true })

    mockSearchEngine = new MockSearchEngine() as any
    contentManager = new ContentManager({
      searchEngine: mockSearchEngine as any,
      referencesDir,
    })
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  describe('getContentStats', () => {
    it('should return correct statistics', () => {
      // Create some test files
      writeFileSync(join(referencesDir, 'user', 'doc1.md'), '# Doc 1')
      writeFileSync(join(referencesDir, 'user', 'doc2.md'), '# Doc 2')
      // Context7 files are now in project subdirectories
      mkdirSync(join(referencesDir, 'context7', 'test-project'), { recursive: true })
      writeFileSync(join(referencesDir, 'context7', 'test-project', 'doc3.md'), '# Doc 3')

      const stats = contentManager.getContentStats()

      expect(stats.userFiles).toBe(2)
      expect(stats.context7Files).toBe(1)
      expect(stats.totalFiles).toBe(3)
      expect(stats.userDirExists).toBe(true)
      expect(stats.context7DirExists).toBe(true)
    })

    it('should handle empty directories', () => {
      const stats = contentManager.getContentStats()

      expect(stats.userFiles).toBe(0)
      expect(stats.context7Files).toBe(0)
      expect(stats.totalFiles).toBe(0)
      expect(stats.userDirExists).toBe(true)
      expect(stats.context7DirExists).toBe(true)
    })
  })

  describe('listContent', () => {
    beforeEach(() => {
      // Create test files with timestamps
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      writeFileSync(join(referencesDir, 'user', 'user-doc.md'), '# User Doc')
      // Context7 files are now in project subdirectories
      mkdirSync(join(referencesDir, 'context7', 'test-project'), { recursive: true })
      writeFileSync(join(referencesDir, 'context7', 'test-project', 'api-doc.md'), '# API Doc')

      // Mock file stats with different times to ensure consistent order
      vi.mock('node:fs', () => ({
        existsSync: vi.fn(),
        readdirSync: vi.fn(),
        statSync: vi.fn((filePath) => ({
          size: 100,
          mtime: filePath.includes('user-doc') ? now : yesterday,
        })),
      }))
    })

    it('should list all content', () => {
      vi.unmock('node:fs')
      const content = contentManager.listContent()

      expect(content.length).toBe(2)
      // Check both files are present regardless of order
      const filenames = content.map((c) => c.filename)
      expect(filenames).toContain('user-doc.md')
      expect(filenames).toContain('api-doc.md')

      // Check sources are correct
      const userDoc = content.find((c) => c.filename === 'user-doc.md')
      const apiDoc = content.find((c) => c.filename === 'api-doc.md')
      expect(userDoc?.source).toBe('user')
      expect(apiDoc?.source).toBe('context7')
    })

    it('should filter by source', () => {
      vi.unmock('node:fs')
      const userContent = contentManager.listContent('user')

      expect(userContent.length).toBe(1)
      expect(userContent[0].source).toBe('user')
    })
  })

  describe('addUserContent', () => {
    it('should add new content', async () => {
      const result = await contentManager.addUserContent({
        title: 'Test Document',
        content: '# Test\nThis is a test document.',
      })

      expect(result.added).toBe(true)
      expect(result.filePath).toContain('test_document')
      expect(result.message).toContain('Created new content')

      // Check file exists
      expect(existsSync(result.filePath!)).toBe(true)

      // Check file content
      const content = readFileSync(result.filePath!, 'utf-8')
      expect(content).toContain('# Test Document')
      expect(content).toContain('This is a test document.')
    })

    it('should handle existing similar content', async () => {
      // Add initial content
      await contentManager.addUserContent({
        title: 'React Guide',
        content:
          '# React Guide\nReact is a UI library for building user interfaces with components and state management.',
      })

      // Add the document to search engine index
      await mockSearchEngine.addDocuments([
        {
          id: 'react-guide',
          title: 'React Guide',
          content:
            'React is a UI library for building user interfaces with components and state management.',
          source: 'user',
          filename: 'React_Guide.md',
        },
      ])

      // Try to add very similar content
      const result = await contentManager.addUserContent({
        title: 'React Tutorial',
        content:
          '# React Tutorial\nReact is a UI library for building user interfaces with components and state management.',
      })

      // Should find similar content and not add
      expect(result.added).toBe(false)
      expect(result.similarFound).toBeGreaterThan(0)
      expect(result.similarContent).toBeDefined()
      expect(result.similarContent!.length).toBeGreaterThan(0)
      expect(result.similarContent?.[0]?.score).toBeGreaterThan(0)
      expect(result.similarContent?.[0]?.sourceRank).toBe('primary')
    })

    it('should update existing content with autoUpdate', async () => {
      // Add initial content
      await contentManager.addUserContent({
        title: 'React Guide',
        content: '# React Guide\nReact is a UI library.',
      })

      // Add the document to search engine index
      await mockSearchEngine.addDocuments([
        {
          id: 'react-guide',
          title: 'React Guide',
          content: 'React is a UI library.',
          source: 'user',
          filename: 'React_Guide.md',
        },
      ])

      // Add enhanced content (much longer to trigger update)
      const result = await contentManager.addUserContent({
        title: 'React Guide',
        content:
          '# React Guide\n\nReact is a UI library for building user interfaces with a component-based architecture. It allows developers to create large web applications that can change data without reloading the page. It aims to provide speed, simplicity, and scalability. React can be used with a combination of other libraries or frameworks to build complex applications. The library maintains a virtual DOM that optimizes rendering performance. Components can be functional or class-based, with hooks providing state management in functional components. React follows a unidirectional data flow pattern which makes the application more predictable and easier to debug. The ecosystem includes React Router for navigation, Redux for state management, and numerous other libraries that complement the core functionality.',
        autoUpdate: true,
      })

      // Should update since new content is significantly longer
      expect(result.updated).toBe(true)
      expect(result.message).toContain('Updated existing content')
    })

    it('should create a user note when similar content only exists in context7', async () => {
      await mockSearchEngine.addDocuments([
        {
          id: 'context7/zod-mini.md',
          title: 'Parse object schema with Zod Mini',
          content:
            'Zod Mini can parse object schemas and provides a lightweight API surface for bundle-sensitive applications.',
          source: 'context7',
          filename: 'zod-mini.md',
          metadata: {
            backendId: 'minisearch',
            rerankScore: 0.81,
          },
          score: 4.2,
        },
      ])

      const result = await contentManager.addUserContent({
        title: 'Zod Mini local note',
        content:
          'Zod Mini is useful for bundle-sensitive applications and should be paired with local project conventions for stringbool coercion.',
        autoUpdate: true,
      })

      expect(result.added).toBe(true)
      expect(result.updated).toBe(false)
      expect(result.skipped).toBe(false)
      expect(result.filePath).toContain('zod_mini_local_note')
      expect(result.message).toContain('Created new content')
      expect(existsSync(result.filePath!)).toBe(true)
      expect(result.similarFound).toBeGreaterThan(0)
      expect(result.similarContent?.[0]?.score).toBeGreaterThan(0)
      expect(result.similarContent?.[0]?.sourceRank).toBe('primary')

      const content = readFileSync(result.filePath!, 'utf-8')
      expect(content).toContain('stringbool coercion')
    })

    it('should force add content even when similar exists', async () => {
      await contentManager.addUserContent({
        title: 'React Guide',
        content: '# React Guide\nReact is a UI library.',
      })

      const result = await contentManager.addUserContent({
        title: 'React Guide',
        content: '# React Guide\nDifferent content about React.',
        force: true,
      })

      expect(result.added).toBe(true)
      expect(result.filePath).toContain('react_guide')
    })

    it('should treat same-title duplicate content as a knowledge duplicate before file conflict', async () => {
      await contentManager.addUserContent({
        title: 'Duplicate Title',
        content: 'This content should be recognized as an existing knowledge note.',
      })

      const result = await contentManager.addUserContent({
        title: 'Duplicate Title',
        content: 'This content should be recognized as an existing knowledge note.',
      })

      expect(result.skipped).toBe(true)
      expect(result.message).toContain('Existing content is comprehensive enough')
      expect(result.existingFile).toBeUndefined()
      expect(result.similarContent?.[0]?.sourceRank).toBe('primary')
    })

    it('should auto-update same-title content when the new knowledge is materially richer', async () => {
      const initial = await contentManager.addUserContent({
        title: 'Upgrade Title',
        content: '# Upgrade Title\nReact is a UI library.',
      })

      const result = await contentManager.addUserContent({
        title: 'Upgrade Title',
        content:
          '# Upgrade Title\n\nReact is a UI library for building user interfaces with composable components, predictable data flow, and integration patterns for larger applications.',
        autoUpdate: true,
      })

      expect(result.updated).toBe(true)
      expect(result.filePath).toBe(initial.filePath)
      expect(result.message).toContain('Updated existing content')
      expect(result.existingFile).toBeUndefined()
    })

    it('should create unique file names', async () => {
      const result1 = await contentManager.addUserContent({
        title: 'Same Title',
        content: 'First document',
      })

      // Add a second content with same title but no force to create unique file name
      const result2 = await contentManager.addUserContent({
        title: 'Same Title Different',
        content: 'Second document',
      })

      expect(result1.filePath).not.toBe(result2.filePath)
      expect(result1.filePath).toContain('same_title')
      expect(result2.filePath).toContain('same_title_different')
    })

    it('should force overwrite existing file', async () => {
      const result1 = await contentManager.addUserContent({
        title: 'Force Test',
        content: 'First document',
      })

      const result2 = await contentManager.addUserContent({
        title: 'Force Test',
        content: 'Second document',
        force: true,
      })

      expect(result1.filePath).toBe(result2.filePath)
      expect(result1.filePath).toContain('force_test')
      expect(result2.message).toContain('Replaced existing knowledge note')
    })

    it('should force append to existing file', async () => {
      const result1 = await contentManager.addUserContent({
        title: 'Append Test',
        content: 'First document',
      })

      const result2 = await contentManager.addUserContent({
        title: 'Append Test',
        content: 'Second document',
        forceAppend: true,
      })

      expect(result1.filePath).toBe(result2.filePath)
      expect(result1.filePath).toContain('append_test')
      expect(result2.message).toContain('Appended content to existing knowledge note')
    })

    it('should let force target the closest existing user knowledge note even when the new title differs', async () => {
      const initial = await contentManager.addUserContent({
        title: 'Zod Mini local note',
        content: 'Zod mini should stay aligned with stringbool coercion conventions in user workflows.',
      })

      const result = await contentManager.addUserContent({
        title: 'Zod Mini replacement',
        content: 'Zod mini guidance has been replaced with a more opinionated knowledge note.',
        force: true,
      })

      expect(result.added).toBe(true)
      expect(result.filePath).toBe(initial.filePath)
      expect(result.message).toContain('Replaced existing knowledge note')
    })

    it('should let force-append target the closest existing user knowledge note even when the new title differs', async () => {
      const initial = await contentManager.addUserContent({
        title: 'Zod Mini append note',
        content: 'Base note for zod mini workflows.',
      })

      const result = await contentManager.addUserContent({
        title: 'Zod Mini appendix',
        content: 'Additional user-specific guidance for stringbool coercion.',
        forceAppend: true,
      })

      expect(result.added).toBe(true)
      expect(result.filePath).toBe(initial.filePath)
      expect(result.message).toContain('Appended content to existing knowledge note')
    })

    it('should invalidate persisted fulltext artifacts after adding content so the next auto search rebuilds fresh state', async () => {
      const skillDir = join(tempDir, 'skill')
      const assetsDir = join(skillDir, 'assets')
      const referencesDirForSkill = join(assetsDir, 'references')
      mkdirSync(join(referencesDirForSkill, 'user'), { recursive: true })
      mkdirSync(join(assetsDir, 'search'), { recursive: true })

      const searchEngine = await buildSearchEngine({
        mode: 'auto',
        skillDir: assetsDir,
        referencesDir: referencesDirForSkill,
        config: {},
      })
      await searchEngine.initialize?.()
      await searchEngine.buildIndex(referencesDirForSkill)

      const seededStatePath = join(assetsDir, 'search', 'index-state.json')
      expect(existsSync(seededStatePath)).toBe(true)
      const seededState = JSON.parse(readFileSync(seededStatePath, 'utf-8')) as {
        documentCount?: number
      }
      expect(seededState.documentCount).toBe(0)

      const realContentManager = new ContentManager({
        searchEngine,
        referencesDir: referencesDirForSkill,
      })

      const addResult = await realContentManager.addUserContent({
        title: 'Fake timers',
        content:
          'Vitest provides vi.useFakeTimers and vi.advanceTimersByTime for time-dependent tests.',
      })

      expect(addResult.added).toBe(true)
      expect(existsSync(seededStatePath)).toBe(false)

      await searchEngine.initialize?.()
      await searchEngine.buildIndex(referencesDirForSkill)
      const results = await searchEngine.search('fake timers', 5)
      expect(results[0]?.title).toBe('Fake timers')
    })
  })

  describe('updateFromContext7', () => {
    it('should handle successful update', async () => {
      // Mock successful download with longer content that meets minimum section length
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            `# API Documentation

This is the API documentation with enough content to be processed properly.

## Getting Started

This section provides a comprehensive guide to getting started with the API. It includes detailed information about authentication, basic requests, and common patterns. You'll learn how to make your first API call and understand the response format.

## Authentication

To use the API, you need to obtain an API key from your account dashboard. Include this key in the Authorization header of all your requests. The API uses Bearer token authentication for secure access to resources.

## Endpoints

The API provides various endpoints for different operations. Each endpoint supports specific HTTP methods and requires certain parameters. Understanding these endpoints is crucial for effective API integration.`
          ),
      })

      const result = await contentManager.updateFromContext7('/api/docs')

      expect(result.updated).toBe(true)
      expect(result.filesCreated).toBeGreaterThan(0)
      expect(result.message).toContain('Updated')
    })

    it('should handle download failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      })

      const result = await contentManager.updateFromContext7('/api/docs')

      expect(result.updated).toBe(false)
      expect(result.message).toContain('Failed to update')
    })

    it('should skip update if not needed', async () => {
      // First update with sufficient content
      const testContent = `# API Documentation

This is detailed API documentation with enough content to pass validation and be properly indexed.

## Overview

The API provides comprehensive functionality for managing resources. Each endpoint is designed with REST principles and returns JSON responses.`

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(testContent),
      })

      await contentManager.updateFromContext7('/api/docs', false)

      // Second update should skip (same content)
      const result = await contentManager.updateFromContext7('/api/docs', false)

      expect(result.skipped).toBe(true)
      expect(result.message).toContain('up to date')
    })

    it('should force update when specified', async () => {
      // First update with sufficient content
      const testContent = `# API Documentation

This is detailed API documentation with enough content to pass validation and be properly indexed for searching.

## Features

The API includes many powerful features for developers including authentication, rate limiting, and comprehensive error handling.`

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(testContent),
      })

      await contentManager.updateFromContext7('/api/docs', false)

      // Force update
      const result = await contentManager.updateFromContext7('/api/docs', true)

      expect(result.updated).toBe(true)
      expect(result.message).toContain('Updated')
    })

    it('should store, list, and remove slash-separated context7 project ids safely', async () => {
      const testContent = `# React Query

This documentation is long enough to produce indexed slices for the encoded project id path.

## Query Keys

Query keys should be deterministic, serializable, and scoped by resource identity.`

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(testContent),
      })

      const projectId = '/tanstack/react-query'
      const result = await contentManager.updateFromContext7(projectId, false)

      expect(result.updated).toBe(true)
      expect(
        existsSync(join(referencesDir, 'context7', encodeURIComponent(projectId)))
      ).toBe(true)

      const projects = contentManager.listContext7Projects()
      expect(projects).toHaveLength(1)
      expect(projects[0]?.projectId).toBe(projectId)

      const removal = contentManager.removeContext7Project(projectId)
      expect(removal.success).toBe(true)
      expect(
        existsSync(join(referencesDir, 'context7', encodeURIComponent(projectId)))
      ).toBe(false)
    })
  })

  describe('extractSections', () => {
    it('should extract markdown sections correctly', async () => {
      const content = `# Introduction
This is the introduction.

## Getting Started
Step 1

### Installation
npm install package

## Advanced Topics
More info here`

      writeFileSync(join(referencesDir, 'test.md'), content)

      const result = await contentManager.addUserContent({
        title: 'Test',
        content,
      })

      expect(result.added).toBe(true)
    })

    it('should filter out very short sections', async () => {
      const content = `# Title
Short.

## Another Title
This section has more content to meet the minimum length requirement for indexing.`

      const result = await contentManager.addUserContent({
        title: 'Test',
        content,
      })

      expect(result.added).toBe(true)
    })
  })
})
