---
name: |
  {{ NAME }}
description: |
  {{ DESCRIPTION }}
---

# {{NAME}}

{{DESCRIPTION}}

<skill-package name="{{PACKAGE_NAME}}" version="{{PACKAGE_VERSION_HINT}}">
</skill-package>

## Package Basics

- Package: `{{PACKAGE_NAME}}`
- Homepage: {{PACKAGE_HOMEPAGE}}
- Repository: {{PACKAGE_REPOSITORY}}
- Summary: {{PACKAGE_SUMMARY}}

## Installation Basics

```bash
pnpm add {{PACKAGE_NAME}}
npm install {{PACKAGE_NAME}}
yarn add {{PACKAGE_NAME}}
```

## CLI Commands

```bash
# Add user content
skill-creator add-skill --pwd "{{SKILL_PATH}}" [--title "Title" --content "Content"]|[--file=*.md]

# Replace the closest matching user note with new knowledge
skill-creator add-skill --pwd "{{SKILL_PATH}}" --title "Replacement" --content "Content" --force

# Append a structured knowledge update into the closest matching user note
skill-creator add-skill --pwd "{{SKILL_PATH}}" --title "Update" --content "Content" --force-append

# Search documentation
skill-creator search-skill --pwd "{{SKILL_PATH}}" "query" [--mode=auto|fulltext|fuzzy|vector]

# Build or refresh the persisted search index
skill-creator build-index --pwd "{{SKILL_PATH}}" [--mode=auto|fulltext|vector]

# Download Context7 docs from the package metadata stored in this skill
skill-creator download-context7 --pwd "{{SKILL_PATH}}"

# Download Context7 docs with an explicit package override
skill-creator download-context7 --pwd "{{SKILL_PATH}}" --package "{{PACKAGE_NAME}}" --package-version "{{PACKAGE_VERSION_HINT}}"

# Update Context7 docs
skill-creator download-context7 --pwd "{{SKILL_PATH}}" --force

# List all Context7 projects
skill-creator list-context7 --pwd "{{SKILL_PATH}}"

# Remove Context7 project
skill-creator remove-context7 --pwd "{{SKILL_PATH}}" <context7_library_id>
```

## User Skills

<user-skills baseDir="assets/references/user">
</user-skills>

## Context7 Documentation

<!-- Context7 projects will be listed here automatically -->
