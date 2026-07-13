# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Colección personal de skills, plugins y commands para Claude Code. Potencial marketplace.

## Structure

- `skills/` - Skills personalizados (archivos `.md` con instrucciones)
- `plugins/` - Plugins MCP (configuración y servidores)
- `commands/` - Commands reutilizables

## Creating Components

### Skills
Skills are markdown files with YAML frontmatter defining triggers and behavior. Place in `skills/` with descriptive names.

### Plugins
Follow Claude Code plugin structure with `plugin.json` manifest. Can include agents, hooks, and MCP server configurations.

**Versioning (REQUIRED for auto-update):** Whenever you change any plugin under `plugins/`, bump its version (semver: minor = new feature, patch = fix) in **both** places, kept in sync:
1. `plugins/<plugin>/.claude-plugin/plugin.json` → `version`
2. The plugin's entry in `.claude-plugin/marketplace.json` → `version`

Claude Code only pulls an update when the version increases. Forgetting either file — especially the marketplace entry — means the change never reaches installed instances. Commit the bump together with the change.

### Commands
Slash commands with YAML frontmatter for arguments and descriptions.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (spulido99/claude-toolkit) via the `gh` CLI; external PRs ARE a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — each triage role's label equals its canonical name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
