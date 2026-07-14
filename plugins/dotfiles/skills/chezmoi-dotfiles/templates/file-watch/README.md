# File Watch Templates

Ready-to-copy chezmoi source files for the OS-native file watcher pattern. See [file-watch-sync.md](../../resources/file-watch-sync.md) for the full guide.

## Files

| Template | Chezmoi source path | Purpose |
|----------|-------------------|---------|
| `config.json.tmpl` | `dot_config/chezmoi-watch/config.json.tmpl` | Watch entries — edit to add your watched files |
| `chezmoi-watch-handler` | `dot_local/bin/executable_chezmoi-watch-handler` | Generic handler script (copy as-is) |
| `launchd-agent.plist.tmpl` | `private_Library/LaunchAgents/com.chezmoi.watch.plist.tmpl` | macOS launchd agent — add WatchPaths entries |
| `launchd-reload.tmpl` | `private_Library/LaunchAgents/run_onchange_after_reload-chezmoi-watch.tmpl` | macOS agent reload script (copy as-is) |
| `systemd-path.tmpl` | `dot_config/systemd/user/chezmoi-watch.path.tmpl` | Linux systemd path unit — add PathChanged entries |
| `systemd-service.tmpl` | `dot_config/systemd/user/chezmoi-watch.service.tmpl` | Linux systemd service unit (copy as-is) |
| `systemd-reload.tmpl` | `dot_config/systemd/user/run_onchange_after_reload-chezmoi-watch.tmpl` | Linux unit reload script (copy as-is) |

## Setup

1. Copy all files to their chezmoi source paths
2. Edit `config.json.tmpl` — add your watch entries
3. Edit the launchd plist / systemd path unit — add matching WatchPaths / PathChanged entries
4. Add to `.chezmoiignore`:
   ```
   {{ if ne .chezmoi.os "darwin" }}
   Library/
   {{ end }}
   {{ if ne .chezmoi.os "linux" }}
   .config/systemd/
   {{ end }}
   ```
5. Run `chezmoi apply` — the reload scripts bootstrap the watcher automatically

## Adding a new watched file

1. Add an entry to `config.json.tmpl`
2. Add a matching `<string>` to the launchd plist's `WatchPaths` array
3. Add a matching `PathChanged=` to the systemd `.path` unit
4. `chezmoi apply` — the `run_onchange_` scripts detect the config hash change and reload
