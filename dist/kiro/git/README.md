# Git Utilities

Deterministic git tooling for agents. **Never estimate git statistics — run the scripts.**

## Tools

- **`diff-stats.sh [BASE] [HEAD]`** — exact change metrics: meaningful (generated-file-excluded)
  vs raw line counts and an implementation-vs-test split. (Local; no GitHub auth.)
- **`gst`** — stacked-PR manager for chains of dependent branches:
  `create` / `list` / `restack` / `submit` / `up` / `down` / `log` / `adopt` / `orphan`, with
  stack metadata stored in git config. (`submit` and the PR-status column in `list` use the `gh` CLI.)
- **`git-identity`** — per-host identity router: resolve a remote → commit author + optional GPG
  signing key + arbitrary namespaced fields, and `apply` them to a repo. Provider-agnostic; the
  SSH key stays owned by ssh config. `resolve` / `apply` / `field` / `fields` / `doctor` /
  `validate` (also works as `git identity <cmd>`). See `skills/git-identity/SKILL.md`.

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
