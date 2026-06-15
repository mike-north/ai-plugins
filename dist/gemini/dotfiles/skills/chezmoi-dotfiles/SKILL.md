---
name: chezmoi-dotfiles
description: General-purpose guide for managing dotfiles with chezmoi, covering naming conventions, templates, encryption, multi-environment support, and portable paths.
user-invocable: false
---

# Chezmoi Dotfiles Guide

Semantic expertise for working with chezmoi-managed dotfiles repositories. Activates automatically when editing chezmoi files, setting up machines, managing encrypted secrets, or working with templates.

## When to Apply

- Editing or creating chezmoi-managed config files
- Setting up a new machine with chezmoi
- Adding or modifying encrypted secrets
- Working with the work/personal machine split
- Troubleshooting chezmoi template rendering
- Adopting chezmoi for a new dotfiles repository

---

## Chezmoi Naming Conventions

Source files use prefixes and suffixes that chezmoi interprets during apply:

| Prefix/suffix | Effect |
|---|---|
| `dot_` | Becomes `.` in target path (e.g., `dot_bashrc` → `~/.bashrc`) |
| `private_` | Restricted file permissions (0600/0700) on apply |
| `executable_` | Gets execute permission on apply |
| `encrypted_` | Decrypted with age on apply |
| `create_` | Only created if target doesn't exist (won't overwrite) |
| `modify_` | Runs as a script to modify an existing target file |
| `remove_` | Removes the target file on apply |
| `run_` | Executed as a script on apply |
| `run_once_` | Executed once, then recorded (won't re-run) |
| `run_onchange_` | Re-executed when the script's content changes |
| `.tmpl` suffix | Processed as a Go template before writing |

Prefixes can be combined: `private_dot_config` → `~/.config` with restricted permissions.

---

## Essential Commands

```bash
chezmoi init                     # Initialize chezmoi (creates ~/.local/share/chezmoi)
chezmoi init --apply <repo>      # Clone a dotfiles repo and apply immediately
chezmoi apply                    # Deploy source → ~/ (idempotent, safe to re-run)
chezmoi diff                     # Preview what apply would change
chezmoi cat <target-path>        # Render a template without applying (debug tool)
chezmoi add <file>               # Add a file to chezmoi management
chezmoi add --encrypt <file>     # Add a file with age encryption
chezmoi update                   # Pull from git remote + apply
chezmoi managed                  # List all managed files
chezmoi unmanaged                # List files in ~/ not managed by chezmoi
```

### Workflow tips

- **Always diff before apply** on a new machine or after pulling changes: `chezmoi diff`
- **Debug templates** with `chezmoi cat`: shows rendered output without writing to disk
- **`chezmoi apply` is idempotent** — running it multiple times produces the same result

---

## Template Basics

Files with the `.tmpl` suffix are processed as Go templates. Chezmoi provides data fields and functions for use in templates.

### Built-in data

| Variable | Example | Description |
|---|---|---|
| `{{ .chezmoi.homeDir }}` | `/Users/alice` | Home directory (portable) |
| `{{ .chezmoi.sourceDir }}` | `/Users/alice/.local/share/chezmoi` | Chezmoi source directory |
| `{{ .chezmoi.os }}` | `darwin`, `linux` | Operating system |
| `{{ .chezmoi.arch }}` | `amd64`, `arm64` | CPU architecture |
| `{{ .chezmoi.hostname }}` | `macbook-pro` | Machine hostname |

### Custom data (`.chezmoi.toml.tmpl`)

Define custom data fields with `promptBoolOnce` and `promptStringOnce` — the user is asked once, and the answer persists:

```
{{- $isWork := promptBoolOnce . "isWorkMachine" "Is this a work machine?" -}}

[data]
isWorkMachine = {{ $isWork }}
```

After the first run, the answer is stored in `~/.config/chezmoi/chezmoi.toml` and never re-asked.

### Template syntax essentials

```
{{- if .someFlag }}            # Conditional block
content here
{{- end }}

{{- if .someFlag }}
option A
{{- else }}
option B
{{- end }}

{{- $var := "value" -}}        # Variable assignment
{{ $var }}                      # Variable use
```

The `-` trims whitespace: `{{-` trims before, `-}}` trims after. Use these to avoid blank lines in output.

---

## `.chezmoiignore`

Controls which source files are skipped during apply. Supports glob patterns and can be templated.

```
# Always ignore
README.md
CLAUDE.md

# Conditionally ignore
{{ if not .someCondition }}
path/to/skip/
{{ end }}
```

Common use: skip encrypted files when the decryption key isn't available (see [encryption resource](./resources/encryption-and-secrets.md)).

---

## `.chezmoiexternal.toml`

Pull in external repositories or archives as part of `chezmoi apply`. Use the `.tmpl` suffix for conditional blocks.

```toml
[".config/external-tool"]
type = "git-repo"
url = "https://github.com/user/repo.git"
refreshPeriod = "168h"
```

See [multi-environment resource](./resources/multi-environment.md) for conditional external repos.

---

## Script Types

Chezmoi supports auto-run scripts with different execution strategies:

| Prefix | Behavior | Use when |
|---|---|---|
| `run_` | Runs every `chezmoi apply` | Rare — most things should be idempotent files |
| `run_once_` | Runs once, recorded by hash | One-time setup (install tools, create directories) |
| `run_onchange_` | Re-runs when script content changes | Reacting to config changes (e.g., re-run Brewfile) |

### When to use scripts vs. explicit execution

| Type of change | Approach |
|---|---|
| Declarative config files | Let chezmoi manage them directly (idempotent file writes) |
| Idempotent package management (Brewfile, apt) | `run_onchange_` is reasonable |
| System-level changes (macOS defaults, systemd units) | Prefer explicit manual execution — these can have surprising side effects |
| One-time provisioning (key generation, directory creation) | `run_once_` or an explicit setup script |

If in doubt, prefer explicit setup scripts over auto-run scripts. Auto-run scripts execute on every `chezmoi apply` (or on change), which can be surprising. Explicit scripts are more predictable and can be run with `--dry-run` flags.

---

## Partial File Management with `modify_` Scripts

By default, chezmoi replaces the entire target file on every `chezmoi apply`. For files where an external tool also writes settings (e.g., an IDE writing `model` preferences into a JSON config), this causes chezmoi to overwrite those tool-written values.

The `modify_` prefix solves this. Instead of replacing the file, chezmoi runs the modify script with the current target file on stdin. The script outputs the desired content, and chezmoi writes that.

### Pattern: JSON partial merge

For JSON config files where you want chezmoi to control some keys but preserve others:

1. Create a `modify_<filename>.tmpl` script (not a plain `<filename>.tmpl`)
2. The script reads the current file from stdin
3. Defines the "managed" JSON (the keys chezmoi controls) with Go template directives
4. Uses `jq` to merge: unmanaged keys from the existing file are preserved, managed keys overwrite

```bash
#!/bin/bash
set -euo pipefail

current=$(cat)
[ -z "$current" ] && current='{}'

managed=$(cat <<'__MANAGED__'
{
  "managedKey": "chezmoi controls this",
  "nested": { "also": "managed" }
}
__MANAGED__
)

# Shallow merge: managed keys replace, unmanaged keys are preserved
jq -s '.[0] + .[1]' <(printf '%s' "$current") <(printf '%s' "$managed")
```

### Merge semantics

Use `jq`'s `+` (shallow merge), not `*` (recursive deep merge):

| Operator | Behavior | Use when |
|---|---|---|
| `+` | Top-level keys from right overwrite left; nested objects are replaced entirely | You want chezmoi to own entire nested structures (permissions, hooks, plugins) |
| `*` | Recursive merge — nested objects are merged key-by-key | You want to merge at every nesting level (rarely what you want for config files) |

With `+`, unmanaged top-level keys (e.g., `model`, `effortLevel`) persist across `chezmoi apply`, while managed keys (e.g., `permissions`, `hooks`) are fully replaced by the template.

### First-time setup

When the target doesn't exist yet, stdin is empty. The `[ -z "$current" ] && current='{}'` fallback ensures `jq` gets valid JSON. The result is just the managed keys — the user or tool can add unmanaged keys later, and they'll persist.

### Requirements

This pattern requires `jq`. On macOS, install via `brew install jq`. On Linux, it's typically available via `apt install jq` or `yum install jq`.

---

## General Conventions

- **Idempotency**: `chezmoi apply` should always be safe to re-run
- **Template debugging**: Use `chezmoi cat <target>` to inspect rendered output
- **Diff before apply**: Always `chezmoi diff` on a new machine or after changes
- **Portable paths**: Never hardcode home directory paths — see [portable paths resource](./resources/portable-paths.md)
- **Source of truth**: The chezmoi source directory is the source of truth; target files are derived

---

## Adopting Chezmoi for Your Dotfiles

A walkthrough for setting up a new chezmoi dotfiles repository with encryption and multi-environment support.

### 1. Initialize

```bash
chezmoi init
cd ~/.local/share/chezmoi
git init
```

### 2. Add your first files

```bash
chezmoi add ~/.bashrc
chezmoi add ~/.gitconfig
```

### 3. Set up machine-type detection

Create `.chezmoi.toml.tmpl` with `promptBoolOnce` to detect or ask about the machine type. See [multi-environment resource](./resources/multi-environment.md) for patterns.

### 4. Set up encryption

Generate an age key pair and configure chezmoi to use it. Store the key in a secrets manager for provisioning to new machines. See [encryption resource](./resources/encryption-and-secrets.md) for the full setup.

### 5. Add a bootstrap flow

Configure `.chezmoiignore` to skip encrypted files when the key is missing. Write setup scripts for key provisioning. This ensures `chezmoi init --apply` works on fresh machines. See [encryption resource](./resources/encryption-and-secrets.md#bootstrap-flow-with-conditional-ignore).

### 6. Enforce portable paths

Add a pre-push hook to catch hardcoded home directory paths. See [portable paths resource](./resources/portable-paths.md#enforcement-pre-push-git-hook).

### 7. Publish and clone

```bash
# Push to a git remote
cd ~/.local/share/chezmoi
git remote add origin git@github.com:user/dotfiles.git
git push -u origin main

# Clone on a new machine
chezmoi init --apply user/dotfiles
```

---

## Resource Files

For deep-dive topics, see:

- **[Encryption and Secrets](./resources/encryption-and-secrets.md)** — Age encryption, 1Password integration, key provisioning, headless environments
- **[Multi-Environment](./resources/multi-environment.md)** — Work/personal splits, macOS/Linux, conditional templates and external repos
- **[Portable Paths](./resources/portable-paths.md)** — Home directory portability, pre-push hook enforcement
- **[File Watch and Sync](./resources/file-watch-sync.md)** — Auto-sync external file changes back into chezmoi using OS-native file watchers (launchd/systemd)
- **[macOS Settings Sync](./resources/macos-settings-sync.md)** — Allowlist-based plist management: readable XML diffs, partial file control, cfprefsd handling
- **[macOS Settings Sync — Guided Workflow](./resources/macos-settings-sync-guided.md)** — Step-by-step agent workflow for guiding users through plist setup. Includes how to present choices, adapt to user experience level, and handle each phase conversationally.

## Templates

Ready-to-copy file templates for common patterns. Each directory contains a README with setup instructions and the files to copy into your chezmoi source directory.

- **[`templates/file-watch/`](./templates/file-watch/)** — OS-native file watcher infrastructure (launchd + systemd). Generic handler, config, and reload scripts.
- **[`templates/macos-plist/`](./templates/macos-plist/)** — macOS plist partial management. Merge tool, per-app modify/restart scripts.
