# macOS Plist Templates

Ready-to-copy chezmoi source files and utility scripts for allowlist-based macOS plist management. See [macos-settings-sync.md](../../resources/macos-settings-sync.md) for the full strategy guide.

## Utility Scripts

These scripts help with the key curation workflow — deciding which keys to manage, extracting them, and keeping them in sync.

| Script | Purpose |
|--------|---------|
| `plist-audit` | List all keys in a plist with types and values. With `--classify`, heuristically categorizes keys as "settings" (manage) vs "state" (ignore). |
| `plist-extract` | Extract selected keys from a live plist into a managed XML file. Accepts keys as arguments or from a file. |
| `plist-merge` | Ongoing merge (chezmoi → app) and sync (app → chezmoi). Deployed to `~/.local/bin/`. |

### Typical workflow for a new app

```bash
# 1. Audit: see all keys and get a suggested classification
python3 plist-audit --classify ~/Library/Preferences/com.example.App.plist

# 2. Review the output. Copy the "settings" keys you want to manage.
#    Optionally save them to a keys file for documentation:
cat > managed-keys.txt << 'EOF'
# Window layouts
appSpecs
manualSpecs

# Behavior preferences
allowAnyShortcut
launchOnLogin
hideMenubarIcon
EOF

# 3. Extract those keys into the managed XML plist
python3 plist-extract --from-file \
    ~/Library/Preferences/com.example.App.plist \
    ~/.local/share/chezmoi/private_Library/private_Preferences/private_com.example.App.managed.plist \
    managed-keys.txt

# 4. Verify the XML is readable
cat ~/.local/share/chezmoi/private_Library/private_Preferences/private_com.example.App.managed.plist
```

## Chezmoi Source Files

These templates go into your chezmoi source directory. Copy and rename per the table.

| Template | Copy to (chezmoi source path) | Purpose |
|----------|-------------------------------|---------|
| `plist-merge` | `dot_local/bin/executable_plist-merge` | Merge/sync tool (shared across all apps, copy once) |
| `modify-plist.tmpl` | `private_Library/private_Preferences/modify_private_com.example.App.plist.tmpl` | Per-app modify script — update managed plist path |
| `restart-app.tmpl` | `private_Library/private_Preferences/run_onchange_after_modify_private_com.example.App.plist.tmpl` | Per-app restart script — update app name and paths |

## Full Setup Checklist

1. **Copy `plist-merge`** to `dot_local/bin/executable_plist-merge` (once, shared)
2. **Audit the app's keys**: `python3 plist-audit --classify ~/Library/Preferences/com.example.App.plist`
3. **Choose keys to manage** — settings yes, state no (see [key selection guide](../../resources/macos-settings-sync.md#choosing-which-keys-to-manage))
4. **Extract managed keys**: `python3 plist-extract ...` (see workflow above)
5. **Copy `modify-plist.tmpl`** → rename, update the managed plist path inside
6. **Copy `restart-app.tmpl`** → rename, update the app name, include path, and bundle ID
7. **Add to `.chezmoiignore`**:
   ```
   {{ if ne .chezmoi.os "darwin" }}
   Library/
   {{ end }}
   Library/Preferences/*.managed.plist
   ```
8. **Add a file watcher entry** for automatic reverse sync (see [`../file-watch/`](../file-watch/) templates)
9. **Test**: `chezmoi diff`, `chezmoi apply`, change a setting in the app, check `git diff`
