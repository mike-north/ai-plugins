---
name: dotfiles
description: Dotfiles management — chezmoi, fish shell, and environment configuration
version: 0.0.1
---

# Dotfiles

Guidance for managing dotfiles with [chezmoi](https://chezmoi.io): naming
conventions, templates, encryption, multi-environment support, and portable
paths.

## Capabilities

- **chezmoi workflows**: Source-state naming, `.tmpl` templating, and applying
  changes safely across machines.
- **Secrets & encryption**: Encrypting sensitive files and integrating secret
  managers without leaking plaintext into the repo.
- **Multi-environment config**: Per-host and per-OS variation via template data
  and conditionals.
- **Portable paths**: Writing configs that resolve correctly on macOS and Linux.
- **File-watch sync & macOS plist sync**: Reusable templates under the skill's
  `templates/` directory for automated reload and settings capture.

## Related Files

- `skills/chezmoi-dotfiles/` — the skill, its `resources/`, and `templates/`
- `steering/` — Steering files for Kiro
- `mcp.json` — MCP server configuration
