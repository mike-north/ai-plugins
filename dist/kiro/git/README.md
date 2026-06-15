# Git Utilities

Deterministic local-git tooling for agents. **Never estimate git statistics — run the
scripts.** Local-VCS only; no GitHub auth required.

## Tools

- **`diff-stats.sh [BASE] [HEAD]`** — exact change metrics: meaningful (generated-file-excluded)
  vs raw line counts and an implementation-vs-test split.
- **`gst`** — stacked-PR manager for chains of dependent branches:
  `create` / `list` / `restack` / `submit` / `up` / `down` / `log` / `adopt` / `orphan`, with
  stack metadata stored in git config.

Plus worktree-discipline guidance for working a stack. Full reference: `skills/git/SKILL.md`.

## Setup

Scripts are in `scripts/`. Call them by path (`${CLAUDE_PLUGIN_ROOT}/scripts/<name>`) or symlink
them onto your `PATH` (e.g. `~/bin`) for bare-name invocation and stable allowlist entries
(`Bash(diff-stats.sh:*)`, `Bash(gst:*)`):

```bash
ln -sf "$PLUGIN/scripts/"* ~/bin/    # then `diff-stats.sh`, `gst list`, …
```

## License

ISC
