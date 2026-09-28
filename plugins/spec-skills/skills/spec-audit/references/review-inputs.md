# Optional review-input check

Use this only when Git and Node.js are available and a committed review snapshot is identified. The Markdown-only workflow does not depend on it. Select the actual documents and reference targets needed for the bounded review; the helper does not discover them or parse Markdown links.

```sh
node /path/to/spec-skills/skills/spec-audit/scripts/review-inputs.mjs \
  --repo /path/to/checkout --revision COMMIT -- \
  docs/design/domain-plan.md docs/design/adoption-contract.md
```

The two document names are examples, not a required layout. Supply an explicit commit or ref and repository-root-relative file paths. The helper resolves the ref to a commit once and reports that commit plus each selected path's Git mode/object ID. Review those committed bytes, not a newer local file with the same name. It does not certify that the current worktree matches the snapshot.

- Exit 0: every selected path is a regular file in that snapshot.
- Exit 1: at least one path is missing or is a directory, symlink, or submodule reference rather than regular file content.
- Exit 2: invalid invocation, unresolved commit, or a Git read failure; no complete report is available.

Staged-only, untracked, and ignored drafts are absent from a committed snapshot. A symlink to private notes does not bring their substance into the revision. The helper does not follow working-tree symlinks, read file contents, mutate Git/configuration, fetch objects, or contact a service.

Presence is not acceptance, sufficiency, semantic alignment, link validity, or exhaustive coverage. A regular file containing only an external issue link may still lack the rationale required for review. An absent document can be legitimate if different accepted artifacts provide the meaning. Use the findings to focus judgment, never as an automatic code-approval gate.

For uncommitted authoring work, identify the collection as a draft and state what still must be included in the eventual reviewable revision. Do not commit merely to silence this helper unless committing is part of the authorized work. For read-only reviewers without shell access, use the supplied revision's file set and report access limits directly.
