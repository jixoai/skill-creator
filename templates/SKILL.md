---
name: |
  {{ NAME }}
description: |
  {{ DESCRIPTION }}
---

# {{NAME}}

{{DESCRIPTION}}

## CLI Commands

```bash
# Add user content
skill-creator add-skill --pwd "{{SKILL_PATH}}" [--title "Title" --content "Content"]|[--file=*.md]

# Search documentation
skill-creator search-skill --pwd "{{SKILL_PATH}}" "query" [--mode=auto|fulltext|fuzzy|vector]

# Download Context7 docs
skill-creator download-context7 --pwd "{{SKILL_PATH}}" <context7_library_id>

# Update Context7 docs
skill-creator download-context7 --pwd "{{SKILL_PATH}}" --force <context7_library_id>

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
