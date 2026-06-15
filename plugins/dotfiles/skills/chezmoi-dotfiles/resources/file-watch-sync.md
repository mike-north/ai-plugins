# File Watch and Sync

Pattern for automatically syncing external changes back into the chezmoi source directory. Uses native OS file watchers (launchd on macOS, systemd path units on Linux) to trigger sync commands when watched files change — zero-overhead, no daemon process.

## When You Need This

- An application writes to a config file, and you want changes captured in chezmoi's source tree
- You're using a `modify_` script to partially manage a file, and want the reverse direction (app → source) to happen automatically
- You want `git diff` in the chezmoi source dir to reflect live setting changes without manual sync steps

## Architecture

```
┌──────────────┐     OS event      ┌─────────────────┐     runs      ┌──────────────┐
│  Watched     │ ──────────────▶  │  launchd /       │ ──────────▶  │  Handler     │
│  target file │   (kqueue/        │  systemd .path   │              │  script      │
│              │    inotify)       │                  │              │  (generic)   │
└──────────────┘                  └─────────────────┘              └──────┬───────┘
                                                                         │
                                                           reads config, │
                                                           runs commands │
                                                                         ▼
                                                                  ┌──────────────┐
                                                                  │  Config JSON  │
                                                                  │  (watch →     │
                                                                  │   command)    │
                                                                  └──────────────┘
```

### Components

| Component | Location | Platform | Purpose |
|-----------|----------|----------|---------|
| Config file | `~/.config/chezmoi-watch/config.json` | Shared | Maps watch paths to sync commands |
| Handler script | `~/.local/bin/chezmoi-watch-handler` | Shared | Reads config, runs all commands |
| OS watcher | `~/Library/LaunchAgents/com.chezmoi.watch.plist` | macOS | Kernel-level file watcher (kqueue) |
| OS watcher | `~/.config/systemd/user/chezmoi-watch.{path,service}` | Linux | Kernel-level file watcher (inotify) |
| Reload script | `run_onchange_` in chezmoi source | Per-OS | Reloads the watcher when config changes |

### Key design decisions

- **No daemon process** — launchd/systemd watch at the kernel level; the handler is launched on demand, runs, and exits
- **Generic handler** — knows nothing about plist files, XML, or any specific file format; just runs shell commands from config
- **All domain knowledge in config entries** — the `command` field in each config entry contains the full sync logic (e.g., `plist-merge --sync`)
- **Config is chezmoi-managed** — the config file is a chezmoi template, so entries can be conditional on OS, machine type, etc.

## Config Format

```json
[
  {
    "name": "Rectangle Pro preferences",
    "watch": "/Users/alice/Library/Preferences/com.knollsoft.Hookshot.plist",
    "command": "plist-merge --sync /Users/alice/Library/Preferences/com.knollsoft.Hookshot.plist /Users/alice/.local/share/chezmoi/private_Library/private_Preferences/private_com.knollsoft.Hookshot.managed.plist"
  }
]
```

- **`name`** — human-readable label (for logging)
- **`watch`** — absolute path to the file being watched
- **`command`** — shell command to run when the file changes; typically a sync tool that extracts/transforms the live file and writes back to the chezmoi source dir

## Adding a New Watch Entry

1. Add the `modify_` script and managed source file for the target (see the main skill doc on partial file management, or [macOS settings](./macos-settings-sync.md) for plist files)
2. Add a config entry mapping the target path to a sync command
3. Run `chezmoi apply` — the `run_onchange_` script reloads the OS watcher

## How the Handler Works

When any watched path changes:

1. OS detects the change (kernel event, not polling)
2. OS launches the handler script
3. Handler reads `~/.config/chezmoi-watch/config.json`
4. Handler runs every `command` entry (commands are fast and idempotent, so running all of them is fine)
5. Handler exits — no process remains running

Running all commands on every trigger (rather than detecting which path changed) is intentional. With 2–10 entries running sub-second commands, the overhead is negligible, and it avoids complexity around launchd/systemd not reporting which path triggered.

## Platform-Specific Watcher Setup

### macOS (launchd)

The launchd plist uses `WatchPaths` — an array of file paths monitored by kqueue:

```xml
<key>WatchPaths</key>
<array>
  <string>/Users/alice/Library/Preferences/com.knollsoft.Hookshot.plist</string>
</array>
```

Reload after config changes:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.chezmoi.watch.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.chezmoi.watch.plist
```

### Linux (systemd)

Uses a `.path` unit with `PathChanged=` directives and a paired `.service` unit:

```ini
# chezmoi-watch.path
[Path]
PathChanged=/home/alice/.config/some-app/config.json

[Install]
WantedBy=default.target
```

Reload after config changes:

```bash
systemctl --user daemon-reload
systemctl --user restart chezmoi-watch.path
```

## Interaction with `chezmoi diff`

The watcher keeps the chezmoi source files in sync with live application state. This means:

- **`chezmoi diff` shows no changes** when the source is in sync with the target (the normal idle state)
- **`git diff` in the source dir** shows readable changes to the managed source files (e.g., XML plist diffs)
- If you edit a managed source file by hand, `chezmoi diff` shows what `chezmoi apply` would change in the target

The watcher provides the "reverse sync" (target → source) that chezmoi doesn't natively support, complementing chezmoi's forward sync (source → target).

## Caveats

- **Burst writes**: Some apps write to preference files multiple times in quick succession. launchd/systemd coalesce rapid events, so the handler typically runs once after the burst settles.
- **Concurrent writes**: The handler should not run while `chezmoi apply` is running. In practice this isn't an issue — `chezmoi apply` is manual/infrequent and completes in seconds.
- **New entries require watcher reload**: Adding a watch entry to the config requires `chezmoi apply` to regenerate and reload the OS watcher. The `run_onchange_` script handles this automatically.
