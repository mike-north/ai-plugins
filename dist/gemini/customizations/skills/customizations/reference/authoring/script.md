# Authoring a script / CLI (the determinism-first default)

A script is **deterministic logic**: same input → same output, correctness mechanically checkable. It
is both a primitive in its own right *and* the engine that should arm skills, hooks, monitors, and
agents. Reaching for a script is the Axis-1 gate — if the whole need is deterministic, stop here.

## Guidance (no external canonical spec — these are our conventions)

- **Language:** prefer Bash for thin glue, Node ESM (`.mjs`) for anything with parsing/JSON. **No
  external deps** for small helpers — use `node:`/POSIX builtins so the script runs anywhere.
- **Interface:** the **CLI** form (arg parsing + `--help` + sensible exit codes: 0 ok, 1 runtime, 2
  usage) when it'll be invoked repeatedly with varying args; a plain script otherwise.
- **Determinism:** no wall-clock/random in anything that needs to be reproducible; take such values as
  inputs. Make it **testable** (export functions; guard CLI dispatch) and add tests — a script is the
  thing we *can* test cheaply, so do.
- **Placement:** when the script arms another customization, put it in that artifact's `scripts/` and
  list it as a component of the *same* manifest entry (one customization = the skill + its scripts).

## When NOT to stop at a script

If, after pushing everything deterministic into the script, an **irreducible judgment** remains, that
remainder is a skill/agent that *calls* this script — not a reason to abandon the script. And consider
Axis 2: if the residual reasoning is menial/high-volume, run it in a cheap-tier subagent.
