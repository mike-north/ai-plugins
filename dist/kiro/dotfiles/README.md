# dotfiles

Dotfiles management plugin — chezmoi, fish shell, and environment configuration.

## What it does

Provides semantic expertise for working with chezmoi-managed dotfiles repositories. The skill activates automatically when editing chezmoi files, setting up machines, managing encrypted secrets, or working with templates.

## Included Skill: chezmoi-dotfiles

A comprehensive guide covering:

- **Naming conventions** — `dot_`, `private_`, `executable_`, `encrypted_`, `modify_`, etc.
- **Template system** — Go templates, built-in data fields, custom data with `promptBoolOnce`
- **Partial file management** — `modify_` scripts for JSON config files where you control some keys but preserve others
- **Script types** — `run_once_`, `run_onchange_`, when to use scripts vs. explicit execution

## Resource Guides

| Resource | Topic |
|----------|-------|
| Encryption and Secrets | Age encryption, 1Password, key provisioning, headless environments |
| Multi-Environment | Work/personal splits, macOS/Linux, conditional templates |
| Portable Paths | Home directory portability, pre-push hook enforcement |
| File Watch and Sync | Auto-sync file changes using OS-native watchers (launchd/systemd) |
| macOS Settings Sync | Allowlist-based plist management with readable XML diffs |
| macOS Settings (Guided) | Step-by-step agent workflow for plist setup |

## Templates

Ready-to-copy file templates:

- **`templates/file-watch/`** — OS-native file watcher infrastructure
- **`templates/macos-plist/`** — macOS plist partial management
