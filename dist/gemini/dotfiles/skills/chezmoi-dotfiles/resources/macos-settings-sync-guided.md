# macOS Settings Sync — Agent Workflow

Reference for an AI agent setting up plist management for a macOS app. Covers the full workflow from key discovery through verification.

**Adapt to the user.** Not everyone needs the same level of guidance:

- A user who says *"set up plist management for iTerm2, here are the keys I want"* knows what they're doing — skip the discovery phase, use their key list, create the files, done.
- A user who says *"I want to sync my app settings"* without specifics needs the full guided flow.
- Watch for signals: if they mention chezmoi concepts (modify scripts, `.chezmoiignore`), they don't need those explained. If they ask "what's a plist?", they need more context.

**Quick-start for experienced users:** Point them to [`templates/macos-plist/README.md`](../templates/macos-plist/README.md) which has the commands and checklist without explanation. The templates are self-documenting via inline comments.

## When to Use This Workflow

A user says something like:
- "I want to sync my Rectangle Pro settings"
- "Can you manage my iTerm2 preferences with chezmoi?"
- "I changed my app settings and want to save them"
- "Set up plist management for \[app name]"

## Prerequisites Check

Before starting, verify:

1. **chezmoi is initialized**: `chezmoi doctor` should succeed
2. **The skill templates exist**: Check for `templates/macos-plist/` in the skill directory
3. **The app is installed**: The plist file exists at `~/Library/Preferences/<bundle-id>.plist`

If the user doesn't know the app's bundle ID:
```bash
# Find plist files for an app by name (fuzzy)
ls ~/Library/Preferences/ | grep -i "<app-name>"

# Or get the bundle ID from the app itself
osascript -e 'id of app "<App Name>"'
```

## Phase 1: Discover and Classify Keys

**What the agent does:**

1. Run `plist-audit --classify` on the app's plist
2. Present the classification to the user in a readable format
3. Ask the user to confirm or adjust

**Script location:** `templates/macos-plist/plist-audit`

**How to present results to the user:**

Don't dump raw output. Instead, summarize:

> I found **18 keys** in Rectangle Pro's preferences. Based on common patterns, here's how I'd categorize them:
>
> **Settings you'd probably want to sync** (8 keys):
> - `appSpecs` — your window layout definitions
> - `allowAnyShortcut` — whether any keyboard shortcut is allowed
> - `launchOnLogin` — start at login
> - ...
>
> **State/noise to skip** (10 keys):
> - `SULastCheckTime` — Sparkle update timestamp
> - `displayCache` — cached display info with timestamps
> - `Paddle-*` — license activation data
> - ...
>
> Does this look right? Are there any keys you'd move between categories?

**Decision points for the user:**
- Which keys to manage (confirm or adjust the heuristic output)
- Whether to create a keys file for documentation

## Phase 2: Extract Managed Keys

**What the agent does:**

1. Use `plist-extract` to create the managed XML plist
2. Show the user the resulting XML for confirmation
3. Place it in the correct chezmoi source directory

**Script location:** `templates/macos-plist/plist-extract`

```bash
# Direct key list
python3 plist-extract \
    ~/Library/Preferences/com.example.App.plist \
    ~/.local/share/chezmoi/private_Library/private_Preferences/private_com.example.App.managed.plist \
    key1 key2 key3

# Or from a keys file (better for documentation)
python3 plist-extract --from-file \
    ~/Library/Preferences/com.example.App.plist \
    ~/.local/share/chezmoi/private_Library/private_Preferences/private_com.example.App.managed.plist \
    managed-keys.txt
```

**Show the user:** A summary of what was extracted and the XML content.

## Phase 3: Create Chezmoi Source Files

**What the agent does:**

1. Copy `plist-merge` to `dot_local/bin/executable_plist-merge` (if not already present)
2. Create the `modify_` script from the template, substituting the app's bundle ID
3. Create the `run_onchange_` restart script, substituting the app name and paths
4. Update `.chezmoiignore` if needed

**Template locations:** `templates/macos-plist/modify-plist.tmpl`, `templates/macos-plist/restart-app.tmpl`

**Substitutions needed per app:**

| Placeholder | Example value | Where to find it |
|-------------|---------------|------------------|
| `com.example.App` | `com.knollsoft.Hookshot` | Bundle ID from phase 1 |
| `"Example App"` | `"Rectangle Pro"` | App name as shown in Applications |
| Managed plist path | `private_com.knollsoft.Hookshot.managed.plist` | Derived from bundle ID |

**Explain to the user:** What each file does and why.

> I've created three files in your chezmoi source directory:
>
> 1. **modify script** — when you run `chezmoi apply`, this merges your managed settings into the live plist without touching other keys
> 2. **restart script** — automatically restarts the app when your managed settings change, so the app picks up the new values
> 3. **managed keys XML** — the readable list of your settings. This is what you'll see in `git diff` when settings change.

## Phase 4: Set Up File Watcher (Optional but Recommended)

**What the agent does:**

1. Check if the file watcher infrastructure exists (config, handler, launchd/systemd units)
2. If not, set it up from `templates/file-watch/`
3. Add a watch entry for this app's plist

**Explain to the user:**

> The file watcher automatically syncs your settings back to git whenever you change them in the app. Without it, you'd need to run a manual sync command. It uses macOS's built-in file watching (launchd) — zero CPU cost when idle, and the sync takes milliseconds when triggered.
>
> Want me to set this up?

## Phase 5: Test and Verify

**What the agent does:**

Walk the user through verification, running each command and explaining the result:

1. `chezmoi diff ~/Library/Preferences/com.example.App.plist` — should show the managed key changes (or nothing if already in sync)
2. `chezmoi apply ~/Library/Preferences/com.example.App.plist` — apply the settings
3. `plutil -lint ~/Library/Preferences/com.example.App.plist` — verify the plist is valid
4. `chezmoi apply` again — should produce no changes (idempotent)

**Then explain the ongoing workflow:**

> From now on:
> - **You change settings in the app** → the file watcher syncs them to git automatically. Run `git diff` to see what changed, then commit when ready.
> - **You pull someone else's settings** → run `chezmoi apply` to push them into the app.
> - **You set up a new machine** → `chezmoi apply` restores your settings automatically.

## Phase 6: Ongoing Maintenance

**Adding more keys later:**

1. Re-run `plist-audit` to see current keys
2. Add new keys to the managed plist using `plist-extract` or manually edit the XML
3. `chezmoi apply` pushes the new keys

**Removing managed keys:**

1. Edit the managed XML plist to remove the key
2. The key becomes unmanaged — the app controls it entirely now
3. `chezmoi apply` to pick up the change

**Debugging:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `chezmoi diff` shows binary diff after every apply | cfprefsd cache race | The restart script should handle this. If not, quit the app manually before applying. |
| Settings lost after restart | cfprefsd flush overwrites plist | Ensure the restart script has the re-apply step (see template) |
| File watcher not triggering | Agent not loaded | `launchctl list \| grep chezmoi` should show the agent. Re-run `chezmoi apply` to reload. |
| XML shows changes you didn't make | App wrote to a managed key on launch | Review whether that key should actually be managed |

## Adapting to the User

**Read signals, don't assume a level.** The same user might be expert-level with git but unfamiliar with chezmoi, or know plists inside-out but never have used `launchctl`. Adapt per-topic, not per-person.

### Signals that the user wants less guidance
- They provide a key list upfront
- They mention chezmoi internals (`modify_`, source dir, `.chezmoiignore`)
- They refer to files by their chezmoi source names
- They ask you to "just do it" or "set it up"
- They've done this before for another app

**Response:** Skip explanations. Run the audit/extract, create the files, show a summary of what you created and where. Let them review.

### Signals that the user wants more guidance
- They ask what a plist is, or what chezmoi does
- They say "I want to sync my settings" without specifics
- They ask "what keys should I include?"
- They're unsure about the classification output

**Response:** Walk through each phase. Summarize the audit output in plain language. Explain what each file does when you create it. Describe the ongoing workflow at the end.

### What everyone needs regardless of experience
- A summary of which files were created and where
- Verification that the setup works (`chezmoi diff`, `chezmoi apply`, idempotency check)
- A note about the file watcher for automatic reverse sync (offer, don't force)
