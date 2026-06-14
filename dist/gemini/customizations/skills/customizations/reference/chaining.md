# Chaining — neutralize expensive/noisy sources

The multiplier behind the doctrine: **never make the agent the detector.** A "sense/react" need
splits into **detection** (mechanical) and **response** (the agent). When the raw source is
expensive or noisy, insert a deterministic **extractor script** between the source and the
monitor/hook so the agent is woken only on a confirmed, relevant, *small* signal.

## Recipe A — expensive external source → script → `command-poll` monitor

The canonical case: a Google Doc (or any system) reachable only through an **expensive MCP tool**
(e.g. 15k-token responses). The anti-pattern is an agent loop that re-pulls the whole doc and diffs
it in-context every few minutes — costly and unreliable. Instead:

1. **Extractor script** — calls the tool (or API/CLI) and emits *only the salient slice* as JSON.

   ```bash
   #!/usr/bin/env bash
   # watch-signups.sh — emit just the review sign-up table
   set -euo pipefail
   fetch-doc --id "$DOC_ID" | jq -c '.tables.signups[] | {slot, name}'
   ```

2. **`command-poll` monitor** — runs the script on an interval and `json-diff`s its stdout, paging
   the agent only on a real delta. Use keyed-collection to track per-row changes and ignore noise.

   ```yaml
   ---
   name: Review sign-up changes
   watch:
     type: command-poll
     command: ['/abs/path/watch-signups.sh']
     interval: 5m
     change-detection:
       strategy: json-diff
       collection:
         path: $        # the array emitted by the script
         ignore-paths: [ '$[*].updated_at' ]
   urgency: normal
   ---
   A review sign-up slot changed. Summarize which slots were added/removed and whether it affects my schedule.
   ```

Result: deterministic polling + diffing (≈free, reliable), reasoning touched **once**, on a small
confirmed signal. Same shape as the `mcp → script + skill` decomposition — capability becomes a
script; activation becomes the monitor.

## Recipe B — react to the agent's own action → hook (no polling)

"Every time I edit `schema.prisma`, regenerate the client." The anti-pattern is a subagent that
re-reads the file on a timer, or a rule that *nags* the model to remember. Use a **hook** on the
agent's own write event — deterministic, zero-overhead, guaranteed:

```yaml
# hooks/claude.yaml (authored via update-config / authoring/hook.md)
hooks:
  PostToolUse:
    - matcher: Write
      hooks:
        - type: command
          command: >-
            case "$TOOL_INPUT" in *schema.prisma*) npx prisma generate ;; esac
```

## When NOT to involve the agent at all

If the reaction needs **no** judgment — purely mechanical, no signal to interpret — it's just a
**script** (wired to a hook for the agent's own actions, or to OS `cron` for time). Don't manufacture
a monitor delivery the agent must read if nothing needs reasoning.

## Rule of thumb

> Push **detection** all the way down to deterministic code; spend the agent only on **response**,
> and only when a real change warrants judgment. If the source is fat, slim it with a script first.
