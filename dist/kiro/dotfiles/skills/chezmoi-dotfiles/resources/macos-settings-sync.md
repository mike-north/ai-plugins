# macOS Settings Sync with Chezmoi

Strategy for managing macOS application preferences (`.plist` files) with chezmoi. Uses an allowlist-based approach: store only the keys you care about as readable XML, merge them into the live binary plist on apply, and auto-sync changes back when the app updates settings.

## When You Need This

- You want to version-control macOS app preferences (window layouts, keyboard shortcuts, behavior settings)
- You want readable git diffs instead of opaque binary blobs
- You want `chezmoi apply` to set your preferences without overwriting app state (timestamps, window positions, license data)

## The Problem with Tracking Binary Plists

macOS apps store preferences as binary `.plist` files in `~/Library/Preferences/`. Tracking these directly in chezmoi has three problems:

1. **Opaque in git** — binary plists produce meaningless diffs
2. **All-or-nothing** — chezmoi replaces the entire file, overwriting state the app needs (timestamps, caches, window positions)
3. **Noisy churn** — apps constantly update state keys, producing spurious diffs

## Solution: Allowlist-Based Partial Management

Instead of tracking the whole binary plist, maintain a **managed keys file** — an XML plist containing only the keys you want to control. A `modify_` script merges these into the live binary plist, leaving everything else untouched.

### File layout per app

```
private_Library/private_Preferences/
├── modify_private_com.example.App.plist.tmpl        # Merge script (chezmoi runs this)
├── private_com.example.App.managed.plist             # Managed keys (XML, readable, diffable)
└── run_onchange_after_modify_private_com.example.App.plist.tmpl  # Restart script
```

Plus a shared merge tool:

```
dot_local/bin/executable_plist-merge    # Python 3, uses stdlib plistlib
```

### How it works

**Forward sync** (source → target, `chezmoi apply`):

1. Chezmoi runs the `modify_` script with the current binary plist on stdin
2. The script calls `plist-merge <managed.plist>` which merges managed keys into the current plist
3. If all keys already match, the original bytes are passed through unchanged (avoids spurious binary roundtrip diffs)
4. Chezmoi writes the result to the target path

**Reverse sync** (target → source, automatic via file watcher):

1. The app writes updated preferences to the binary plist
2. The OS file watcher (see [file-watch-sync.md](./file-watch-sync.md)) triggers the handler
3. Handler runs `plist-merge --sync <live.plist> <managed.plist>`
4. The sync extracts only the allowlisted keys from the live plist and updates the managed XML
5. `git diff` in the source dir shows readable XML changes

## Choosing Which Keys to Manage

### Include (managed keys)

- **User preferences**: behavior toggles, feature flags, UI settings
- **Layouts and configurations**: window arrangements, snap zones, workspace definitions
- **Keyboard shortcuts**: custom keybindings, modifier keys
- **Sync settings**: iCloud sync toggles, sync identifiers

### Exclude (state keys — leave unmanaged)

- **Timestamps**: `SULastCheckTime`, `lastEncountered`, `NSWindow Frame *`
- **Caches and state**: `displayCache`, `recentDocuments`, menu bar positions (`NSStatusItem *`)
- **License/activation data**: Paddle tokens, encryption keys, serial numbers
- **Update framework state**: `SU*` (Sparkle), `SUHasLaunchedBefore`
- **Version tracking**: `installVersion`, `lastVersion`
- **One-time flags**: `*Notified`, `*Shown`, `hasLaunchedBefore`

### How to audit keys

Convert the live plist to XML and review every key:

```bash
plutil -convert xml1 -o - ~/Library/Preferences/com.example.App.plist
```

For each key, ask: "If I set up a new machine, would I want this value restored?" If yes, include it. If it's ephemeral state the app regenerates on its own, exclude it.

## Creating the Managed Keys File

Extract your chosen keys from the live plist:

```python
#!/usr/bin/env python3
import plistlib

with open("~/Library/Preferences/com.example.App.plist", "rb") as f:
    current = plistlib.load(f)

managed_keys = [
    "preferenceA",
    "preferenceB",
    "layoutConfig",
]

managed = {k: current[k] for k in managed_keys if k in current}

output = "path/to/private_com.example.App.managed.plist"
with open(output, "wb") as f:
    plistlib.dump(managed, f, fmt=plistlib.FMT_XML, sort_keys=True)
```

The result is a human-readable XML plist containing only your selected keys. This is what you commit to git, and what produces readable diffs.

## The `modify_` Script

A one-liner that pipes chezmoi's stdin through the merge tool:

```bash
#!/bin/bash
set -euo pipefail
exec python3 "{{ .chezmoi.sourceDir }}/dot_local/bin/executable_plist-merge" \
  "{{ .chezmoi.sourceDir }}/private_Library/private_Preferences/private_com.example.App.managed.plist"
```

References source paths (not target paths) to avoid deployment-order dependencies.

## The Restart Script

Uses chezmoi's `run_onchange_` with a content hash to restart the app only when managed keys change:

```bash
#!/bin/bash
# managed keys hash: {{ include "private_Library/private_Preferences/private_com.example.App.managed.plist" | sha256sum }}
set -euo pipefail

PLIST="$HOME/Library/Preferences/com.example.App.plist"
MERGE_TOOL="{{ .chezmoi.sourceDir }}/dot_local/bin/executable_plist-merge"
MANAGED="{{ .chezmoi.sourceDir }}/private_Library/private_Preferences/private_com.example.App.managed.plist"

# Quit app — it will flush in-memory state to disk via cfprefsd,
# potentially overwriting the plist that chezmoi's modify_ script just wrote.
osascript -e 'tell application "App Name" to quit' 2>/dev/null || true
sleep 2

# Re-apply managed keys to recover from the cfprefsd overwrite.
python3 "$MERGE_TOOL" "$MANAGED" < "$PLIST" > "${PLIST}.tmp" && mv "${PLIST}.tmp" "$PLIST"

open -a "App Name"
```

### Why the re-apply step?

When a running macOS app quits, it flushes its in-memory preferences to disk via `cfprefsd`, overwriting the file chezmoi just wrote. The restart script compensates: quit the app (which triggers the flush), then re-merge managed keys, then relaunch.

## `.chezmoiignore` Configuration

Two entries are needed:

```
# macOS-only: skip Library/ tree on non-darwin
{{ if ne .chezmoi.os "darwin" }}
Library/
{{ end }}

# Managed plist keys files are source-only (read by modify_ scripts, not deployed)
Library/Preferences/*.managed.plist
```

The first skips all macOS Library files on Linux. The second prevents chezmoi from deploying `.managed.plist` files as standalone targets — they're source-only reference files read by the `modify_` scripts.

## The `plist-merge` Tool

A Python 3 script using `plistlib` (stdlib, no dependencies) with two modes:

**Merge mode** (used by `modify_` scripts):
```bash
plist-merge <managed.plist> < current.plist > merged.plist
```

**Sync mode** (used by file watcher or manually):
```bash
plist-merge --sync <live.plist> <managed.plist>
```

Sync mode reads the live plist, extracts only the keys that exist in the managed file, and overwrites the managed XML with updated values. It prints a summary of what changed.

## Adding a New App

1. **Audit keys**: `plutil -convert xml1 -o -` on the live plist, categorize each key as managed or state
2. **Extract managed keys**: Write the managed keys to a `private_com.example.App.managed.plist` XML file
3. **Create `modify_` script**: One-liner calling `plist-merge` (see template above)
4. **Create restart script**: `run_onchange_` with hash embedding (see template above)
5. **Add file watcher entry**: Add a config entry to `chezmoi-watch/config.json` for reverse sync
6. **Update `.chezmoiignore`**: The `*.managed.plist` glob already covers new apps; add OS guards if needed
7. **Test**: `chezmoi diff`, `chezmoi apply`, change a setting in the app, verify `git diff` shows readable XML

## Verifying the Setup

```bash
# Forward sync works
chezmoi diff ~/Library/Preferences/com.example.App.plist
chezmoi apply ~/Library/Preferences/com.example.App.plist
plutil -lint ~/Library/Preferences/com.example.App.plist

# Idempotent
chezmoi diff ~/Library/Preferences/com.example.App.plist  # should be empty

# Reverse sync works (after changing a setting in the app)
git -C ~/.local/share/chezmoi diff  # should show readable XML changes

# State preservation (change a UI element to write state keys)
chezmoi diff ~/Library/Preferences/com.example.App.plist  # should be empty
```
