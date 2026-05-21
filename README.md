# Skill Creator

A powerful composite tool for creating and managing Claude Code skills. It serves as both:

1. **CLI Tool** - A TypeScript/Node.js command-line interface for skill management
2. **Claude Code Subagent** - An intelligent agent that automates skill creation workflow

## Features

### Core Capabilities

- 🚀 **Automated Skill Creation**: Generate skills with proper folder naming (`package@version` format)
- 📚 **Context7 Integration**: Resolve the best Context7 project ID, then download and slice documentation automatically
- 🔍 **Intelligent Search**: Lightweight local full-text search with optional explicit vector mode
- 💾 **Dynamic Content Management**: Add custom knowledge with deduplication

### CLI & Subagent

- 🛠️ **Modern TypeScript**: Full type safety with ESM modules
- 🎯 **CLI-first Workflow**: Non-interactive by default, with explicit interactive prompts when requested
- 🤖 **Subagent Mode**: Intelligent agent that handles the entire skill creation workflow
- 📦 **Flexible Storage**: Store skills in project (`.claude/skills/`) or user directory (`~/.claude/skills`)

## Installation

### Install skill-creator

```bash
npm install -g skill-creator
```

### Verify Installation

After installation, verify that the CLI is available:

```bash
skill-creator --help
```

If the help output renders, the local skill workflow is available.

### Runtime Prerequisites

`skill-creator` does not require Claude Code MCP servers for its core CLI workflow.

It uses:
- npm registry HTTP APIs for `search` and `get-info`
- Context7 HTTP APIs for `resolve-context7` and `download-context7`

You only need normal outbound network access when using those commands.

## Quick Start

### 1. Install as CLI Tool

```bash
npm install -g skill-creator
```

### 2. Setup for Claude Code

```bash
# Interactive installation - installs skill-creator to Claude Code
skill-creator init
```

### 3. Choose Your Usage Mode

#### CLI Mode - Full Control

Use commands directly for complete control over the skill creation process.

#### Subagent Mode - Effortless

Simply describe what you want, and let the subagent handle everything automatically.

```
User: Use skill-creator subagent to help me create a vitest skill

User: Tell me about vitest testing patterns
```

The skill-creator subagent will handle the entire workflow automatically.

### 4. Create a Skill by cli

```bash
# Search for packages
skill-creator search "react query"

# Get package information (Options)
skill-creator get-info @tanstack/react-query

# Create skill with custom package name (recommended)
skill-creator create-cc-skill --scope user --name "@tanstack/react-query" --description "React Query for data fetching" @tanstack/react-query@5

# Create skill with interactive prompts
skill-creator create-cc-skill --scope user --interactive --description "React Query for data fetching" @tanstack/react-query@5

# Resolve the best Context7 project id
skill-creator resolve-context7 @tanstack/react-query

# Download documentation directly from the package name
skill-creator download-context7 --package @tanstack/react-query --package-version 5.0.0

# If the skill was created from a package, the package metadata is stored in SKILL.md
# so the same download can usually be triggered with only the skill path
skill-creator download-context7 --pwd ~/.claude/skills/@tanstack__react-query@5

# Or download with an explicit resolved Context7 id
skill-creator download-context7 --package @tanstack/react-query /tanstack/react-query

# Search your skill knowledge base
skill-creator search-skill --package @tanstack/react-query "useQuery hook"

# Append a structured knowledge update into the closest matching user note
skill-creator add-skill --package @tanstack/react-query --title "Bundle guidance" --content "Prefer React Query cache ownership conventions in bundle-sensitive apps." --force-append
```

## Commands

### Installation & Setup

| Command   | Description                                                 |
| --------- | ----------------------------------------------------------- |
| `init`    | Install skill-creator as Claude Code subagent (interactive) |
| `init-cc` | Install skill-creator as subagent in user directory         |

### Skill Creation (CLI Mode)

| Command                  | Description                      |
| ------------------------ | -------------------------------- |
| `search <keywords>`      | Search npm packages              |
| `get-info <package>`     | Get detailed package information |
| `resolve-context7 <package>` | Resolve the best Context7 library id |
| `create-cc-skill <name>` | Create a new skill directory     |

### Content Management

| Command                          | Description                               |
| -------------------------------- | ----------------------------------------- |
| `download-context7 [project_id]` | Download and slice Context7 documentation |
| `search-skill <query>`           | Search in skill knowledge base            |
| `add-skill`                      | Add custom knowledge to skill             |

> **Tip**: When using the skill-creator as a subagent, you don't need to remember these commands. Just tell Claude what you want to create, and the subagent will handle the entire workflow automatically.

### Options

- `--scope <user|current>`: Storage location for skills (required)
- `--name <name>`: Package name for the skill (recommended)
- `--pwd <path>`: Working directory for skill operations
- `--package <name>`: Use package name to find skill directory
- `--package-version <version>`: Version hint for Context7 library resolution
- `--description <description>`: Custom description for the skill
- `--force`: Replace the closest matching user knowledge note when adding content
- `--force-append`: Append a structured knowledge update into the closest matching user note
- `--skip-indexing`: Skip automatic local index building
- `--interactive`: Enable interactive prompts

When `--package <name>` is used to find an existing skill, the CLI first checks the
`<skill-package ...>` metadata stored in `SKILL.md`. Directory-name matching is only a fallback.

## Workflow

### Complete Skill Creation Workflow

1. **Search Package**: Find the right package for your skill

   ```bash
   skill-creator search "state management"
   ```

2. **Get Package Info**: Retrieve detailed information

   ```bash
   skill-creator get-info zustand
   ```

3. **Create Skill**: Set up skill directory (requires --scope, recommended to use --name)

   ```bash
   # With custom package name (recommended)
   skill-creator create-cc-skill --scope current --name zustand --description "Zustand state management" zustand@5

   # With interactive prompts
   skill-creator create-cc-skill --scope current --interactive zustand
   ```

4. **Resolve Context7 Project ID**: Pick the strongest Context7 source for the package

   ```bash
   skill-creator resolve-context7 zustand --package-version 5.0.0
   ```

5. **Download Documentation**: Get Context7 docs with automatic indexing

   ```bash
   # Simplest path when the skill already stores package metadata
   skill-creator download-context7 --pwd ~/.claude/skills/zustand@5

   # One-step path: resolve and download from the package name
   skill-creator download-context7 --package zustand --package-version 5.0.0

   # Two-step path: supply the explicit Context7 project id
   skill-creator download-context7 --package zustand /zustand
   ```

6. **Add Custom Knowledge**: Enhance with your own content

   ```bash
   skill-creator add-skill --package zustand --title "Best Practices" --content "Your custom notes"

   # Replace the closest existing user note
   skill-creator add-skill --package zustand --title "Best Practices" --content "Updated note" --force

   # Append a structured update into the closest existing user note
   skill-creator add-skill --package zustand --title "Operational update" --content "Additional guidance" --force-append
   ```

7. **Search Knowledge Base**: Query your skill
   ```bash
   skill-creator search-skill --package zustand "typescript patterns"
   ```

## Directory Structure

```
.claude/skills/
└── package@version/
    ├── assets/
    │   ├── references/
    │       ├── context7/     # Auto-sliced Context7 docs
    │       └── user/         # Custom knowledge files
    │   └── search/          # Local search indexes and state
    └── SKILL.md             # Skill documentation
```

## Development

### Development Setup

```bash
# Install dependencies
npm install

# Development mode with watch
npm run dev

# Build TypeScript
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
pnpm ts
```

### Testing Context7 Integration

To test the built-in Context7 workflow during development:

```bash
skill-creator resolve-context7 vitest --package-version 4.1.7
skill-creator download-context7 --help
```

### Verifying Installed Binaries During Development

When validating the real installed CLI during local development, prefer isolated install roots instead of relying on your machine's global package manager state:

```bash
# Source-mode workflow verification
pnpm verify:workflow

# Published-style installed binary verification in an isolated prefix
pnpm verify:installed

# Source-linked binary verification in an isolated prefix
pnpm verify:linked
```

If you still want a linked local binary for ad hoc manual testing, use an isolated prefix:

```bash
TMP_PREFIX="$(mktemp -d /tmp/skill-creator-link-XXXXXX)"
npm_config_prefix="$TMP_PREFIX" npm link
PATH="$TMP_PREFIX/bin:$PATH" skill-creator --help
```

This avoids toolchain managers such as Volta interfering with the linked executable.

## Search Modes

- `auto`: default path, tries full-text first and falls back to fuzzy when quality is weak
- `fulltext`: explicit MiniSearch-backed local index
- `fuzzy`: explicit `uFuzzy` fallback for path/term-style matching
- `vector`: explicit SQLite vector search path when the local runtime supports it

`chroma` remains accepted only as an undocumented legacy alias for `vector`.

## Architecture

- **TypeScript + ESM**: Modern JavaScript with full type safety
- **Search Runtime**: MiniSearch-backed local full-text indexing by default, with explicit vector mode available when runtime support exists
- **Context7 API**: Automated documentation downloading and slicing
- **CLI-first Design**: Professional command-line interface
- **Modular Architecture**: Clean separation of concerns

## License

MIT

---

_For detailed subagent usage, see `templates/skill-creator.md`_
