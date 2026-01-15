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

### Commands
Slash commands with YAML frontmatter for arguments and descriptions.
