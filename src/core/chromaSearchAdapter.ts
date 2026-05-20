/**
 * ChromaDB Search Adapter
 * Implements on-demand ChromaDB search with automatic fallback to fuzzy search
 */

import { ChromaClient } from 'chromadb'
import { DefaultEmbeddingFunction } from '@chroma-core/default-embed'
import type {
  SearchBackendInfo,
  SearchEngine,
  SearchIndexState,
  SearchOptions,
  SearchResult,
} from './searchAdapter.js'
import { FuzzySearchAdapter } from './fuzzySearchAdapter.js'
import { ChromaServerManager } from './chromaServerManager.js'

export interface ChromaSearchOptions {
  /** 技能目录路径 */
  skillDir: string
  /** ChromaDB 集合名称 */
  collectionName: string
  /** 启动超时时间（毫秒） */
  startupTimeout?: number
  /** 是否启用自动回退 */
  enableFallback?: boolean
}

export interface ChromaPreparedResult {
  /** ChromaDB 客户端 */
  client: ChromaClient
  /** 服务器信息 */
  serverInfo: {
    port: number
    dataPath: string
  }
  /** 是否需要自动关闭服务器 */
  shouldAutoShutdown: boolean
}

/**
 * ChromaDB Search Adapter
 * 支持按需启动、自动回退和优雅关闭
 */
export class ChromaSearchAdapter implements SearchEngine {
  private fuzzyAdapter: FuzzySearchAdapter
  private serverManager: ChromaServerManager
  private options: ChromaSearchOptions
  private isIndexBuilt = false
  private embeddingFunction: DefaultEmbeddingFunction

  constructor(options: ChromaSearchOptions) {
    this.options = options
    this.fuzzyAdapter = new FuzzySearchAdapter()
    this.serverManager = ChromaServerManager.getInstance()
    this.embeddingFunction = new DefaultEmbeddingFunction()
  }

  /**
   * 统一准备ChromaDB环境
   * 封装服务器启动、客户端创建和配置的通用逻辑
   */
  private async prepareChromadb(
    operation: 'search' | 'build-index' | 'clear-index' = 'search',
    autoShutdown: boolean = true
  ): Promise<ChromaPreparedResult> {
    // 检查服务器是否已运行
    const isServerRunning = this.serverManager.isServerRunning({
      skillDir: this.options.skillDir,
    })

    let serverInfo
    let shouldAutoShutdown = autoShutdown

    if (isServerRunning) {
      // 服务器已运行，获取现有信息
      serverInfo = this.serverManager.getServerInfo({
        skillDir: this.options.skillDir,
      })!
      console.log(`🔄 使用现有的 ChromaDB 服务器 (端口: ${serverInfo.port})`)
      shouldAutoShutdown = false // 现有服务器不自动关闭
    } else {
      // 启动新服务器
      serverInfo = await this.serverManager.startServer({
        skillDir: this.options.skillDir,
        startupTimeout: this.options.startupTimeout,
      })
    }

    // 创建ChromaDB客户端
    console.log(`🔗 连接到 ChromaDB: http://localhost:${serverInfo.port}`)
    const client = new ChromaClient({
      host: 'localhost',
      port: serverInfo.port,
    })

    // 测试连接
    try {
      await client.heartbeat()
      console.log(`✅ ChromaDB 连接成功`)
    } catch (error) {
      throw new Error(
        `ChromaDB 连接失败: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    return {
      client,
      serverInfo: {
        port: serverInfo.port,
        dataPath: serverInfo.dataPath,
      },
      shouldAutoShutdown,
    }
  }

  /**
   * 安全关闭ChromaDB服务器
   */
  private async safeShutdownServer(
    serverInfo: { port: number; dataPath: string },
    shouldShutdown: boolean
  ): Promise<void> {
    if (!shouldShutdown) {
      console.log(`🔄 保持 ChromaDB 服务器运行 (端口: ${serverInfo.port})`)
      return
    }

    try {
      await this.serverManager.stopServer({
        skillDir: this.options.skillDir,
      })
      console.log(`✅ ChromaDB 服务器已关闭 (端口: ${serverInfo.port})`)
    } catch (error) {
      console.warn(`⚠️ 关闭 ChromaDB 服务器时出现警告:`, error)
    }
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { topK = 5, where } = options

    try {
      console.log('🔍 启动 ChromaDB 搜索...')

      // 准备ChromaDB环境
      const { client, serverInfo, shouldAutoShutdown } = await this.prepareChromadb('search')

      try {
        // 获取或创建集合
        let collection
        try {
          collection = await client.getCollection({
            name: this.options.collectionName,
            embeddingFunction: this.embeddingFunction,
          })
          console.log(`📚 获取现有集合: ${this.options.collectionName}`)
        } catch (error) {
          if (!this.isIndexBuilt) {
            console.log(`⚠️ 集合不存在且索引未构建，跳过 ChromaDB 搜索`)
            throw new Error('ChromaDB 索引未构建')
          }
          throw error
        }

        // 检查是否有数据
        try {
          const count = await collection.count()
          if (count === 0) {
            console.log(`📭 集合为空，跳过 ChromaDB 搜索`)
            throw new Error('ChromaDB 集合为空')
          }
        } catch (error) {
          console.log(`⚠️ 无法获取集合计数，可能集合为空`)
          throw new Error('ChromaDB 集合不可访问')
        }

        // 执行搜索
        console.log(`🔎 查询 ChromaDB: "${query}"`)
        const results = await collection.query({
          queryTexts: [query],
          nResults: topK,
        })

        // 转换结果
        const searchResults: SearchResult[] = []
        if (results.ids[0] && results.ids[0].length > 0) {
          for (let i = 0; i < results.ids[0].length; i++) {
            const id = results.ids[0][i]
            const document = results.documents[0]?.[i]
            const metadata = results.metadatas[0]?.[i]
            const distance = results.distances?.[0]?.[i] || 1

            if (id && document) {
              // 将distance转换为similarity
              // ChromaDB使用不同的距离度量，这里使用更通用的转换方法
              let similarity: number

              if (distance <= 0) {
                // 完美匹配
                similarity = 1.0
              } else if (distance <= 1) {
                // 对于小距离使用线性转换
                similarity = 1 - distance
              } else {
                // 对于大距离使用归一化到0-0.3范围
                // 这确保即使距离很大，也不会完全为0
                similarity = Math.max(0.1, 0.3 / distance)
              }

              searchResults.push({
                id,
                title: (typeof metadata?.title === 'string'
                  ? metadata.title
                  : `Document ${id}`) as string,
                content: document,
                source: (metadata?.source === 'user' || metadata?.source === 'context7'
                  ? metadata.source
                  : 'user') as 'user' | 'context7',
                file_path: (typeof metadata?.file_path === 'string'
                  ? metadata.file_path
                  : `unknown/${id}`) as string,
                score: similarity,
                metadata: {
                  ...metadata,
                  similarity: distance,
                  distance: distance,
                  serverPort: serverInfo.port,
                  indexedAt: new Date().toISOString(),
                },
              })
            }
          }
        }

        console.log(`✅ ChromaDB 搜索完成，找到 ${searchResults.length} 个结果`)
        return searchResults
      } finally {
        // 安全关闭服务器
        await this.safeShutdownServer(serverInfo, shouldAutoShutdown)
      }
    } catch (error) {
      console.log(`❌ ChromaDB 搜索失败: ${error instanceof Error ? error.message : String(error)}`)

      // 自动回退到模糊搜索
      if (this.options.enableFallback) {
        console.log('🔄 自动回退到模糊搜索...')
        return this.fuzzyAdapter.search(query, { topK, where })
      }

      throw error
    }
  }

  /**
   * 计算当前文件的hash映射 {filename: hash}
   */
  private async calculateFileHashes(referencesDir: string): Promise<Map<string, string>> {
    const fs = await import('node:fs')
    const { createHash } = await import('node:crypto')
    const { glob } = await import('glob')

    const files = await glob('**/*.md', { cwd: referencesDir })
    const fileHashes = new Map<string, string>()

    for (const file of files.sort()) {
      try {
        const fullPath = `${referencesDir}/${file}`
        const content = fs.readFileSync(fullPath, 'utf-8')
        const hash = createHash('sha256').update(content).digest('hex')
        fileHashes.set(file, hash)
      } catch (error) {
        console.warn(`⚠️ 计算文件hash失败 ${file}:`, error)
      }
    }

    return fileHashes
  }

  /**
   * 加载之前的文件hash缓存
   */
  private async loadFileHashCache(cacheFile: string): Promise<Map<string, string>> {
    const fs = await import('node:fs')
    const path = await import('node:path')

    // 确保缓存目录存在
    const cacheDir = path.dirname(cacheFile)
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true })
    }

    const fileHashes = new Map<string, string>()

    try {
      if (fs.existsSync(cacheFile)) {
        const content = fs.readFileSync(cacheFile, 'utf-8')
        const data = JSON.parse(content)
        Object.entries(data).forEach(([file, hash]) => {
          fileHashes.set(file, hash as string)
        })
      }
    } catch (error) {
      console.warn('⚠️ 读取文件hash缓存失败:', error)
    }

    return fileHashes
  }

  /**
   * 保存文件hash缓存
   */
  private async saveFileHashCache(
    cacheFile: string,
    fileHashes: Map<string, string>
  ): Promise<void> {
    const fs = await import('node:fs')

    try {
      const data = Object.fromEntries(fileHashes)
      fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2))
      console.log('💾 已更新文件hash缓存')
    } catch (error) {
      console.warn('⚠️ 保存文件hash缓存失败:', error)
    }
  }

  /**
   * 分析文件变化
   */
  private analyzeFileChanges(
    currentHashes: Map<string, string>,
    previousHashes: Map<string, string>
  ): {
    added: string[]
    modified: string[]
    deleted: string[]
  } {
    const added: string[] = []
    const modified: string[] = []
    const deleted: string[] = []

    // 检查新增和修改的文件
    for (const [file, currentHash] of currentHashes) {
      const previousHash = previousHashes.get(file)
      if (!previousHash) {
        added.push(file)
      } else if (previousHash !== currentHash) {
        modified.push(file)
      }
    }

    // 检查删除的文件
    for (const file of previousHashes.keys()) {
      if (!currentHashes.has(file)) {
        deleted.push(file)
      }
    }

    return { added, modified, deleted }
  }

  /**
   * 获取或创建集合
   */
  private async getOrCreateCollection(client: any): Promise<any> {
    try {
      const collection = await client.getCollection({
        name: this.options.collectionName,
        embeddingFunction: this.embeddingFunction,
      })
      console.log(`📝 使用现有集合: ${this.options.collectionName}`)
      return collection
    } catch (error) {
      console.log(`📝 创建新集合: ${this.options.collectionName}`)
      return await client.createCollection({
        name: this.options.collectionName,
        embeddingFunction: this.embeddingFunction,
      })
    }
  }

  /**
   * 处理文件变化
   */
  private async processFileChanges(
    collection: any,
    referencesDir: string,
    changes: { added: string[]; modified: string[]; deleted: string[] }
  ): Promise<void> {
    const fs = await import('node:fs')
    const { join, relative } = await import('node:path')

    // 处理删除的文件
    if (changes.deleted.length > 0) {
      try {
        await collection.delete({
          ids: changes.deleted,
        })
        console.log(`🗑️ 已删除 ${changes.deleted.length} 个文档`)
      } catch (error) {
        console.warn('⚠️ 删除文档失败:', error)
      }
    }

    // 处理新增和修改的文件
    const filesToProcess = [...changes.added, ...changes.modified]
    if (filesToProcess.length > 0) {
      console.log(`📝 处理文件变更: 新增 ${changes.added.length}, 修改 ${changes.modified.length}`)

      // 分批处理
      const batchSize = 50
      for (let i = 0; i < filesToProcess.length; i += batchSize) {
        const batch = filesToProcess.slice(i, i + batchSize)
        const documents: string[] = []
        const ids: string[] = []
        const metadatas: any[] = []

        for (const file of batch) {
          try {
            const fullPath = join(referencesDir, file)
            const content = fs.readFileSync(fullPath, 'utf-8')

            // 提取标题
            const lines = content.split('\n')
            const title = lines[0]?.replace(/^#+\s*/, '').trim() || file.replace(/\.md$/, '')

            documents.push(content)
            ids.push(file)
            metadatas.push({
              title,
              file_path: file,
              source: file.includes('context7/') ? 'context7' : 'user',
              file_name: file.split('/').pop() || file,
              updated_at: new Date().toISOString(),
            })
          } catch (error) {
            console.warn(`⚠️ 处理文件失败 ${file}:`, error)
          }
        }

        if (documents.length > 0) {
          // 先删除已存在的文档（用于修改的情况）
          const existingIds = ids.filter((id) => changes.modified.includes(id))
          if (existingIds.length > 0) {
            try {
              await collection.delete({
                ids: existingIds,
              })
            } catch (error) {
              // 忽略删除不存在的文档的错误
            }
          }

          // 添加新的文档
          await collection.add({
            ids,
            documents,
            metadatas,
          })
          console.log(
            `📚 已处理 ${Math.min(i + batchSize, filesToProcess.length)}/${filesToProcess.length} 个文档`
          )
        }
      }
    }
  }

  async buildIndex(referencesDir: string): Promise<void> {
    console.log('🔧 构建 ChromaDB 索引...')

    // 准备ChromaDB环境
    const { client, serverInfo, shouldAutoShutdown } = await this.prepareChromadb(
      'build-index',
      false
    )

    try {
      // 计算当前文件的hash映射
      const currentFileHashes = await this.calculateFileHashes(referencesDir)

      // 读取之前的文件hash缓存
      const cacheFile = `${referencesDir}/../.cache/chroma-file-hashes.json`
      const previousFileHashes = await this.loadFileHashCache(cacheFile)

      // 分析文件变化
      const changes = this.analyzeFileChanges(currentFileHashes, previousFileHashes)

      console.log(
        `📊 文件变化分析: 新增 ${changes.added.length}, 修改 ${changes.modified.length}, 删除 ${changes.deleted.length}`
      )

      if (
        changes.added.length === 0 &&
        changes.modified.length === 0 &&
        changes.deleted.length === 0
      ) {
        console.log('✅ 文件未变化，跳过索引重建')
        this.isIndexBuilt = true
        return
      }

      // 获取或创建集合
      const collection = await this.getOrCreateCollection(client)

      // 处理文件变化
      await this.processFileChanges(collection, referencesDir, changes)

      // 保存新的文件hash缓存
      await this.saveFileHashCache(cacheFile, currentFileHashes)

      // 验证索引
      const count = await collection.count()
      console.log(`✅ ChromaDB 索引更新完成，当前包含 ${count} 个文档`)
      this.isIndexBuilt = true
    } finally {
      // 安全关闭服务器
      await this.safeShutdownServer(serverInfo, shouldAutoShutdown)
    }
  }

  async clearIndex(): Promise<void> {
    console.log('🗑️ 清除 ChromaDB 索引...')

    // 准备ChromaDB环境
    const { client, serverInfo, shouldAutoShutdown } = await this.prepareChromadb(
      'clear-index',
      false
    )

    try {
      try {
        await client.deleteCollection({
          name: this.options.collectionName,
        })
        console.log('✅ ChromaDB 索引已清除')
      } catch (error) {
        console.log('⚠️ ChromaDB 集合不存在或已清除')
      }

      this.isIndexBuilt = false
    } finally {
      // 安全关闭服务器
      await this.safeShutdownServer(serverInfo, shouldAutoShutdown)
    }
  }

  isBuilt(): boolean {
    return this.isIndexBuilt
  }

  getBackendInfo(): SearchBackendInfo {
    return {
      backendId: 'chroma',
      mode: 'vector',
      supportsPersistence: true,
      supportsEmbeddings: true,
    }
  }

  async getStats(): Promise<{ totalDocuments: number }> {
    try {
      // 准备ChromaDB环境
      const { client, shouldAutoShutdown } = await this.prepareChromadb('search')

      try {
        const collection = await client.getCollection({
          name: this.options.collectionName,
          embeddingFunction: this.embeddingFunction,
        })
        const count = await collection.count()
        return { totalDocuments: count }
      } finally {
        // 安全关闭服务器
        if (shouldAutoShutdown) {
          await this.serverManager.stopServer({
            skillDir: this.options.skillDir,
          })
        }
      }
    } catch (error) {
      console.log(`⚠️ 无法获取 ChromaDB 统计信息:`, error)
      return { totalDocuments: 0 }
    }
  }

  async getIndexState(): Promise<SearchIndexState> {
    const stats = await this.getStats()
    return {
      backendId: 'chroma',
      documentCount: stats.totalDocuments,
      builtAt: this.isIndexBuilt ? new Date().toISOString() : undefined,
    }
  }

  /**
   * 获取运行中的服务器状态
   */
  getServerStatus(): {
    isRunning: boolean
  } {
    const isRunning = this.serverManager.isServerRunning({
      skillDir: this.options.skillDir,
    })

    return { isRunning }
  }
}
