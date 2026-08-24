---
name: toolsmith:analyze
description: Mine the Bash history log for broad commands worth turning into purpose-built tools
---

Analyze this project's Bash usage and propose purpose-built toolsmith scripts.
You **propose** — do not create scripts, edit the registry, or change
permissions in this command.

1. **Load the history — through the redacting reader, never a raw Read.** The
   log stores commands verbatim and can contain inline secrets, so the hook
   denies direct reads. Run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/toolsmith-history.mjs" [--grep <regex>] [--limit <N>]`
   to get the JSONL lines (`ts`, `cwd`, `command`, `exitCode`) with
   secret-like values already replaced by `[REDACTED]`. If it reports no
   history or nothing prints, say there is not yet enough signal and stop.

2. **Focus on watched, broad commands.** Consider the shipped watchlist
   (`skills/toolsmith/references/watchlist-defaults.json`) plus any project
   `.claude/toolsmith/config.json` overrides. Prioritize:
   - commands matching a watchlist pattern,
   - long pipelines (multiple `|` stages, especially `... | jq ... | grep`),
   - the same broad operation repeated with only small argument changes.

3. **Cluster and rank.** Group similar commands (normalize away volatile args
   like PR numbers, IDs, timestamps). Rank by frequency and by how awkward the
   command is to allowlist as-is.

4. **Apply the rubric.** For each cluster, judge against
   `skills/toolsmith/references/authoring-checklist.md` (Compound / Missing /
   Guarded / Permission-scopable). Drop clusters that don't clear it.

5. **Propose candidates.** For each surviving cluster, output a concrete
   candidate: suggested `name`, one-line `purpose`, bounded `args`, `scope`,
   `covers` regex(es) that would match the observed commands, and a short script
   sketch. Note which existing registry tools (if any) already cover it.

End by inviting the user to pick candidates to build. For each pick, dispatch
one `tool-curator` agent, passing that candidate's block (name, purpose,
covers, sketch, and the observed commands it was clustered from) as its
capability brief. The curator re-adjudicates from scratch — this command's
clustering never checks native porcelain, so a `no-tool-needed` verdict is
possible and correct even for a candidate that looked solid here. This
command only proposes; the curator (via a staging draft) and the human via
`/toolsmith:approve` are what actually change anything.
