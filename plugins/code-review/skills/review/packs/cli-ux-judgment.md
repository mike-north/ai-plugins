---
pack: cli-ux-judgment
loads_into: [cli-ux]
verified: "2026-07"
sources:
  - https://clig.dev/
  - https://no-color.org/
verify: "Check the CLI's actual completion command (e.g. `<bin> completion bash`) exists before attempting to source it — not every framework/version ships completions."
---

# CLI UX judgment: verifying beyond static output

## Facts to check against

- **Shell completion changes need to be exercised in a real shell, not inferred from source.**
  Claude Code runs non-interactively and can't press Tab directly, but `tmux` can drive a real
  shell session and capture what Tab actually produces:
  ```bash
  tmux new-session -d -s completion-test
  tmux send-keys -t completion-test 'source <(./bin/mycli completion bash)' Enter
  tmux send-keys -t completion-test './bin/mycli tr' Tab
  sleep 1
  tmux capture-pane -t completion-test -p
  tmux kill-session -t completion-test
  ```
  Use this whenever a change adds/renames a command or flag, or touches a custom
  `ValidArgsFunction`/completion function — reading the completion registration code is not
  sufficient evidence that Tab actually produces the right suggestions; the generated completion
  script can silently diverge from the command tree (stale cached completions, a forgotten
  re-registration) in ways only observable by running it.
  - Verify: commands complete correctly (partial → full), flags complete after `--`, custom
    completions (resource IDs, enum values) work, and no errors appear when Tab is pressed.
- **Long-running operations with no progress feedback.** A command that blocks for several seconds
  with no output leaves the user unsure whether it's hung — write a progress indicator to
  **stderr** (so it doesn't pollute piped stdout) and gate it on `process.stderr.isTTY` so
  non-interactive/piped invocations don't get spinner control codes mixed into captured logs:
  ```typescript
  if (process.stderr.isTTY) {
    const spinner = startSpinner('Fetching data...');
    const data = await fetchData();
    spinner.stop();
  } else {
    console.error('Fetching data...');
    const data = await fetchData();
  }
  ```
