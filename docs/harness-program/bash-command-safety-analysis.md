# Minimum Viable Bash Command Safety Analysis

> **Status**: adopted into the harness program canon 2026-07-19 (moved from the original brainstorm drafts). Governs fleet work per [README](./README.md).
>
> **Split assignment** (program ruling, see [DECISIONS](./DECISIONS.md)): the deterministic core — shell-grammar parsing, leaf enumeration, command profiles, cwd tracking/canonicalization, dynamic-construct bail — is **[command steering](./command-steering.md)** input. The learning loop, trust asymmetry, and provenance-of-allow-decisions material is **[judge](./judge.md)** input. The "next step" experiment below is an early command-steering issue.


*Conversation summary · July 18, 2026 · Toolsmith project*

## The question

What is the minimum amount of static analysis on bash commands — including multiline commands and boolean compositions — needed to let AI coding agents proceed autonomously with some of them, while failing closed to human approval whenever there's significant doubt?

## Core reframe

Don't try to understand what a command *does* — bound what it *could possibly do*. Safety is a reachability question, not a comprehension question.

The minimum analysis is three moves:

1. **Parse with a real shell grammar** (not regex), so multiline commands and boolean operators decompose into a tree of simple commands.
2. **Enumerate every leaf** — every program invoked anywhere in the tree. A command is only as safe as its most dangerous reachable node.
3. **Check the full set against known-trusted commands.**

**Automatic bail:** any dynamic construct (`eval`, command substitution in command position, unquoted expansion where a program name goes). If you can't statically know what will run, you can't bound it — fail closed to the human.

## Two motivating scares

Both share the same shape: **the binary name alone is a lie about the command's authority.**

- **`find -exec`** — a traditionally read-only command with an arbitrary-execution flag. Requires per-command knowledge that certain flags are *sub-command spawners* that re-enter the whole analysis with a new leaf. Same category: `xargs`, `awk`'s `system()`, `ssh`, `git -c`.
- **Path traversal** — an allowlist like "rm anything in /tmp" is escapable via `/tmp/../..`. Countermeasure: don't reason about the string — **canonicalize** the argument against the working directory live at that node (symlinks included), then check containment against the allowed root.

This requires tracking the **working directory per leaf node** (complicated by `cd`, subshells, `pushd`) and knowing **which parameters are path expressions or URLs**. Open question deferred to experiment: whether best-effort static cwd tracking (bailing when cwd becomes dynamic) kills too many legitimate commands.

## The liberating constraint

We are not semantically modeling the universe of CLI tools. We need only:

- A **finite set of commonly used commands** (~100, not ~20) with sparse profiles
- **Positively identified dangerous patterns** that trigger a bail (e.g., setting `PATH` — the meta-attack that invalidates binary resolution; likewise `IFS`, `LD_PRELOAD`, `BASH_ENV`)
- Limited semantic understanding: which parameters are locations (local path vs. URL), not what the command does with them (no need to understand FFmpeg's video compression)

## Command profiles are sparse and uneven

`curl` as the stress test: an inordinate flag surface, but the *dangerous* surface is tiny — disk-writing flags (`-o`, `-O`, `--output`), the config-file read (`-K`), local-file upload flags, and the URL as a location expression. Timeouts, headers, retries are safety-irrelevant noise.

A profile is therefore:
- Known dangerous flags
- Known location-bearing arguments
- **A posture toward unknown flags** (harmless for curl; possibly a bail trigger for less-understood commands)

Effort is unevenly distributed: a long cheap tail of mostly read-only tools, with real modeling time concentrated on the scary few (`curl`, `find`, `git`, `ssh`).

## Baseline and the learning loop

The status quo: *everything* reaches the human. The system whittles that queue down, and learns from the residue:

- Capture **why** a command was approved or denied
- Denials are the richer signal — a "no" usually has a specific, nameable reason
- A bare approval is weak evidence: it may reflect the pattern being safe, or just this instance, or rubber-stamp fatigue

## Trust asymmetry — the critical correction

"No worse than baseline" is wrong once a human *delegates*. The human leaves the gate attended by the robot with instructions to wake them when needed. If things get through the door that shouldn't have, the tool is never used again.

- **False bail** (unnecessary human ask): cheap, forgivable, iterate freely
- **False allow** (bad command waved through): catastrophic and asymmetric — one bad let-through destroys the trust a thousand correct decisions built

Design consequence: the two learning directions are treated completely differently. Learning to *bail more* from denials is low-stakes. Learning to *allow more* from approvals is the dangerous direction and should likely never be automatic — only approvals carrying a **legible reason** ("safe *because* the path resolves inside the sandbox") are candidates for real rules.

## Provenance as the trust instrument

Every allow decision must trace back to the specific pieces of human feedback that authorized it. Then even the odd false negative is survivable: the post-mortem isn't "the black box was wrong" (unfixable, terrifying) but "these four approvals composed into a policy with a gap *here*" — a specific, editable line. The human can understand why the bad thing happened and why the fix means it won't happen the same way again.

## Connection to Toolsmith

A matured, articulable "why this pattern is safe" *is* a forged tool: a narrow contract, signed once, that stops asking. The feedback loop and the toolbox are the same mechanism at two speeds — the fast loop whittling the approval queue, the slow loop crystallizing durable patterns into signed capability.

## Next step

A cheap experiment: sample real agent transcripts and measure (a) what fraction of commands are pure compositions of a small known command set, and (b) of the remainder, how many bail for genuinely good reasons versus boring, cheaply-teachable ones. The coverage-versus-false-bail ratio tests whether the bet holds.
