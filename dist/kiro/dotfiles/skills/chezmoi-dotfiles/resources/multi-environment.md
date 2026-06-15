# Multi-Environment Dotfiles

Patterns for managing chezmoi dotfiles across different environments: work vs. personal, macOS vs. Linux, desktop vs. headless.

## When You Need This

- Work and personal machines with different tooling, credentials, or network access
- macOS and Linux machines with different package managers and paths
- Desktop and headless/server environments with different capabilities
- Multiple employers or organizational contexts over time

## Machine Type Detection

### Using filesystem markers

Detect the environment by checking for directories or files that only exist in one context:

```
{{- $isWork := false -}}
{{- if stat "/path/that/only/exists/at/work" -}}
{{-   $isWork = true -}}
{{- end -}}
```

### Prompting with auto-detection

Use `promptBoolOnce` to ask the user with a sensible default. The answer persists in `~/.config/chezmoi/chezmoi.toml` and is never re-asked:

```
{{- $isWork := false -}}
{{- if stat "/path/that/only/exists/at/work" -}}
{{-   $isWork = true -}}
{{- end -}}
{{- $isWork = promptBoolOnce . "isWorkMachine" (printf "Is this a work machine? (detected: %t)" $isWork) -}}
```

### OS detection

Chezmoi provides built-in OS data:

```
{{- if eq .chezmoi.os "darwin" -}}
# macOS-specific
{{- else if eq .chezmoi.os "linux" -}}
# Linux-specific
{{- end -}}
```

### Persisted data

All `promptBoolOnce` / `promptStringOnce` answers are stored in `~/.config/chezmoi/chezmoi.toml` under `[data]`:

```toml
[data]
isWorkMachine = true
hasFeatureX = false
```

## Template Conditionals

### Basic conditional blocks

```
{{- if .isWorkMachine }}
# work-only configuration here
{{- else }}
# personal-only configuration here
{{- end }}
```

### Setting variables conditionally

When a value varies by environment but is used in multiple places within a template:

```
{{- $sshCmd := "ssh" -}}
{{- if .isWorkMachine -}}
{{-   $sshCmd = "corp-ssh" -}}
{{- end }}

Host devbox
    ProxyCommand {{ $sshCmd }} proxy-host
```

### Combining conditions

```
{{- if and .isWorkMachine (eq .chezmoi.os "darwin") }}
# work + macOS only
{{- end }}
```

## External Repos for Environment-Specific Config

Use `.chezmoiexternal.toml` (or `.chezmoiexternal.toml.tmpl` for conditional blocks) to pull in separate repos:

```toml
{{ if .isWorkMachine -}}
[".config/dotfiles-work"]
type = "git-repo"
url = "git@github.example.com:user/dotfiles-work.git"
refreshPeriod = "168h"
{{- end }}
```

This keeps environment-specific config (especially employer-specific secrets or tooling) in a separate private repository, only cloned on relevant machines.

### When to use an external repo vs. template conditionals

| Situation | Approach |
|---|---|
| Small differences (a few lines) | Template conditionals in a single file |
| Entirely different config files | Separate files via external repo or `create_` prefix |
| Employer-specific secrets or credentials | Separate private repo (never in the public dotfiles repo) |
| Shared base + environment overlay | Source the external repo's files from your shell config |

## What to Split vs. What to Template

### Template conditionals (single file, small differences)

Best when the file is mostly the same across environments with a few lines that differ:

```
# ~/.gitconfig (template)
[user]
{{- if .isWorkMachine }}
    email = user@work.com
{{- else }}
    email = user@personal.com
{{- end }}
    name = Your Name
```

### Separate files (entirely different content)

When two environments need completely different files, use environment-specific source files or pull from an external repo. The external repo approach is cleaner because it avoids cluttering the main dotfiles repo with environment-specific files.

### Shared base + overlay

A common pattern for shell configs:

```bash
# In your main shell config (template)
source ~/.config/shell/common.sh

{{- if .isWorkMachine }}
source ~/.config/dotfiles-work/shell/work.sh
{{- end }}
```

This keeps the main config clean while allowing each environment to layer on additional configuration.

## Platform-Specific Patterns

### Package management

```
{{- if eq .chezmoi.os "darwin" }}
# Homebrew paths and config
eval "$(/opt/homebrew/bin/brew shellenv)"
{{- else if eq .chezmoi.os "linux" }}
# Linux-specific paths
{{- end }}
```

### Path differences

Common paths that differ between macOS and Linux:

| Resource | macOS | Linux |
|---|---|---|
| Home directory | `/Users/username` | `/home/username` |
| Homebrew prefix | `/opt/homebrew` | `/home/linuxbrew/.linuxbrew` |
| Application support | `~/Library/Application Support` | `~/.config` or `~/.local/share` |

Use `{{ .chezmoi.homeDir }}` instead of hardcoding any of these. See [portable-paths.md](./portable-paths.md) for more on path portability.
