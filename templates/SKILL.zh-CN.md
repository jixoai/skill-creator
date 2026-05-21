---
name: |
  {{ NAME }}
description: |
  {{ DESCRIPTION }}
---

你是{{NAME}}专业领域助手，专门提供关于{{NAME}}库/框架的全面技术支持和文档查询服务。

## 关于{{NAME}}

{{DESCRIPTION}}

### 核心特性

- **智能搜索**: 默认基于本地轻量全文检索，支持显式向量检索模式
- **动态内容管理**: 支持添加自定义知识点，智能去重和更新
- **Context7集成**: 自动获取和切片最新官方文档
- **优先级管理**: 用户生成内容优先于官方文档

### 设计理念

基于官方文档和社区最佳实践，确保信息的准确性和时效性

注重实用性，提供可直接应用的代码示例和配置方案

循序渐进，从基础概念到高级模式的完整学习路径

持续更新，跟随版本迭代不断优化和完善知识库

### 解决的问题

- **学习曲线复杂**: 通过结构化的知识点和实例，降低学习门槛
- **文档分散**: 整合官方文档、社区经验和实践案例，提供一站式参考
- **最佳实践缺失**: 总结常见设计模式和最佳实践，避免常见陷阱
- **版本更新困扰**: 及时跟踪版本变化，提供迁移指南和新增特性说明

## 使用指南

### 搜索文档知识点

查询{{NAME}}的相关信息、API使用、最佳实践等：

#### 基础搜索

```bash
skill-creator search-skill --pwd="{{SKILL_PATH}}" "搜索关键词"
```

#### 搜索模式选择

```bash
# 自动模式（默认）- 智能选择搜索策略
skill-creator search-skill --pwd="{{SKILL_PATH}}" --mode=auto "搜索关键词"

# Fulltext模式 - 默认全文检索，适合 API、标题、最佳实践检索
skill-creator search-skill --pwd="{{SKILL_PATH}}" --mode=fulltext "搜索关键词"

# Fuzzy模式 - 关键字搜索，字符串模糊匹配
skill-creator search-skill --pwd="{{SKILL_PATH}}" --mode=fuzzy "搜索关键词"

# Vector模式 - 显式向量检索，适合语义查询
skill-creator search-skill --pwd="{{SKILL_PATH}}" --mode=vector "搜索关键词"
```

#### 搜索模式详解

**🤖 Auto 模式（自动模式，默认）**

- **工作原理**: 先执行默认全文检索；若结果为空或质量不足，再回退到 fuzzy 检索
- **适用场景**:
  - 不确定使用哪种搜索方式时
  - 希望获得最佳搜索平衡时
  - 日常快速查询需求
- **优势**: 智能切换，兼顾速度和准确性，用户体验最佳

**📚 Fulltext 模式（默认全文检索）**

- **工作原理**: 基于本地持久化索引进行字段加权、前缀与轻量模糊匹配
- **适用场景**:
  - API 名称、配置项、标题、最佳实践定位
  - 大多数日常文档检索
- **优势**: 无需外部服务，索引构建与查询都更轻量

**🧠 Vector 模式（显式语义搜索）**

- **工作原理**: 基于 SQLite vector 和本地 embedding 理解查询意图与上下文
- **适用场景**:
  - 概念性查询（"如何处理状态管理"）
  - 功能性搜索（"数据验证的方法"）
  - 需要理解语义的复杂查询
  - 查找相关的技术概念和最佳实践
- **优势**: 理解查询意图，能找到语义相关但关键词不完全匹配的内容，适合概念性搜索
- **特点**:
  - 支持自然语言查询
  - 能理解同义词和相关概念
  - 基于语义相似度排序结果
  - 需要构建搜索索引

**🔍 Fuzzy 模式（模糊搜索）**

- **工作原理**: 基于字符串模糊匹配算法，快速查找包含指定关键词的内容
- **适用场景**:
  - 精确关键词搜索（"useQuery"、"useState"）
  - API名称和方法查找
  - 配置项和参数搜索
  - 快速定位特定术语
- **优势**: 响应速度快，关键词匹配精确，适合查找具体的API、配置项、方法名等
- **特点**:
  - 支持部分匹配和模糊匹配
  - 搜索速度快，无需索引
  - 基于关键词相似度排序
  - 适合技术术语和代码片段搜索

#### 实用搜索示例

**API 和方法查询**（推荐 Fuzzy 模式）:

```bash
# 查找特定API
skill-creator search-skill --pwd="{{SKILL_PATH}}" --mode=fuzzy "useQuery"

# 查找配置选项
skill-creator search-skill --pwd="{{SKILL_PATH}}" --mode=fuzzy "baseURL配置"
```

**概念和最佳实践查询**（推荐 Vector 模式）:

```bash
# 概念性问题
skill-creator search-skill --pwd="{{SKILL_PATH}}" --mode=vector "如何优化React组件性能"

# 最佳实践
skill-creator search-skill --pwd="{{SKILL_PATH}}" --mode=vector "状态管理最佳实践"
```

**日常查询**（使用 Auto 模式）:

```bash
# 让系统自动选择最佳搜索方式
skill-creator search-skill --pwd="{{SKILL_PATH}}" --mode=auto "错误处理"
skill-creator search-skill --pwd="{{SKILL_PATH}}" "路由配置"  # --mode=auto 是默认值
```

#### 列表模式显示

如果只需要查看简要信息，可以使用列表模式：

```bash
skill-creator search-skill --pwd="{{SKILL_PATH}}" --list "搜索关键词"
```

### 构建或刷新搜索索引

当你希望提前构建本地持久化索引，或者在 `download-context7 --skip-indexing` 之后补建索引时，可以使用：

```bash
# 自动模式（默认）- 构建默认持久化索引路径
skill-creator build-index --pwd="{{SKILL_PATH}}" --mode=auto

# Fulltext 模式 - 显式构建 MiniSearch 索引
skill-creator build-index --pwd="{{SKILL_PATH}}" --mode=fulltext

# Vector 模式 - 显式构建 SQLite vector 索引（要求当前 runtime 支持）
skill-creator build-index --pwd="{{SKILL_PATH}}" --mode=vector
```

说明：

- `--mode=fuzzy` 不支持单独预建索引，因此会被拒绝
- `--mode=vector` 需要当前 Node runtime 支持 `node:sqlite` 和 `sqlite-vec`

**示例查询：**

- "如何创建router"
- "状态管理最佳实践"
- "错误处理机制"
- "性能优化技巧"
- "TypeScript集成"

### 添加自定义知识点

当发现文档中缺少重要信息时，可以添加自己的知识点：

```bash
skill-creator add-skill --pwd="{{SKILL_PATH}}" --title "知识点标题" --content "详细内容"
```

如果要直接替换最接近的用户知识点：

```bash
skill-creator add-skill --pwd="{{SKILL_PATH}}" --title "替换标题" --content "详细内容" --force
```

如果要把新增内容作为结构化知识更新追加到最接近的用户知识点：

```bash
skill-creator add-skill --pwd="{{SKILL_PATH}}" --title "更新标题" --content "详细内容" --force-append
```

**添加内容类型：**

- 🚀 **最佳实践**: 项目中的实际经验和技巧
- ⚠️ **注意事项**: 容易出错的地方和解决方案
- 🔧 **配置技巧**: 特殊场景的配置方法
- 📚 **学习资源**: 相关教程和链接
- 🐛 **问题解决**: 常见问题和解决步骤

### 更新官方文档

获取最新的官方文档并重新切片：

**强制更新（覆盖现有文档）：**

```bash
skill-creator download-context7 --pwd="{{SKILL_PATH}}" --force
```

### 查看所有内容

列出技能中所有可用的知识点：

```bash
skill-creator list-skills --pwd="{{SKILL_PATH}}"
```

## 文档结构说明

```
{{SKILL_PATH}}/
├── assets/
│   └── references/
│       ├── context7/          # 官方文档切片
│       └── user/              # 用户自定义知识点
│   └── search/                # 本地搜索索引与状态
└── SKILL.md                   # 本文件
```

## 内容优先级

1. **用户内容优先**: `user/` 文件夹中的自定义知识点具有最高优先级
2. **官方文档**: `context7/` 文件夹中的官方文档作为基础参考
3. **智能去重**: 添加内容时自动检测相似度，避免重复信息
4. **版本管理**: 支持文档版本控制和增量更新

## 搜索技巧

### 🔍 **精确搜索**

使用具体的技术术语：

- "useQuery hook用法"
- "路由守卫实现"
- "异步状态管理"

### 🎯 **场景化搜索**

基于使用场景：

- "在React项目中集成"
- "服务端渲染配置"
- "移动端优化"

### 📋 **对比搜索**

比较不同方案：

- "useState vs useReducer"
- "客户端路由 vs 服务端路由"

### 🔧 **问题导向搜索**

描述具体问题：

- "解决内存泄漏问题"
- "优化首次加载时间"
- "处理并发请求"

## 贡献指南

### 📝 **内容贡献**

- 添加实际项目经验和最佳实践
- 分享遇到的问题和解决方案
- 补充官方文档中缺失的信息
- 提供代码示例和配置案例

### 🎯 **质量标准**

- 内容准确，经过实际验证
- 包含具体的代码示例
- 说明适用场景和限制条件
- 遵循现有的格式规范

### 🔄 **持续更新**

- 定期更新官方文档
- 根据版本迭代添加新特性说明
- 修正过时的信息和错误用法

## 工作流程

### 首次使用

1. **基础搜索**: 使用 `search-skill` 查询基础概念
2. **实践验证**: 根据搜索结果进行实际编码
3. **补充内容**: 将实践经验通过 `add-skill` 添加为知识点
4. **分享交流**: 与团队成员分享有价值的发现

### 日常使用

1. **问题查询**: 遇到问题时先搜索现有知识点
2. **内容扩展**: 发现新知识时及时补充
3. **文档更新**: 定期更新官方文档以保持同步
4. **质量维护**: 检查和优化现有知识点质量

## 技术支持

如果遇到技术问题，可以通过以下方式：

1. 搜索现有知识点
2. 查看官方文档部分
3. 添加问题描述到用户知识点
4. 寻求社区帮助

---

## 用户技能

<user-skills baseDir="assets/references/user">
</user-skills>

## Context7 文档

<!-- Context7 项目将自动在此列出 -->

---

_本技能基于skill-creator工具创建，持续更新以提供最佳的技术支持体验。_
