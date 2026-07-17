# Blinding & isolation for blind DX studies

## When to apply

Any time a subagent is acting as a **blind usability-study subject** (or a verifier of one's claims) against a library, CLI, or SDK. These rules are what make the study's findings trustworthy — break them and the results are worthless or, worse, destructive to the host machine.

## The two invariants

### 1. Blinding — the subject knows only what a real user knows

A subject's value is that it has no insider knowledge. Enforce, in every subject/verifier prompt:

- The subject may read ONLY its own workspace directory and an explicitly-provided docs path.
- It must NEVER read the target's source tree (`src/**`, `lib/**`, `crates/**`, internal modules), its test files, its git history, or its issue tracker to figure out intended usage.
- It must NEVER fetch the target's source repository to read implementation. Reading a package's **own shipped** README/docs (inside the installed package, or on its public registry page) IS allowed — that is exactly what a real user sees.
- It must not reach for internal/private/undocumented APIs or any escape hatch that bypasses the public interface to get unstuck. If the public path fails, that failure IS the finding.

Two cohorts sharpen the signal:

- **Cohort A ("found the docs")** — gets copies of the docs a user could plausibly find (e.g. the repo README + generated API reference) placed *in its workspace*. Measures the best-case documented experience.
- **Cohort B ("registry / types only")** — gets NO external docs. May use only the installed package's own metadata, its shipped README, its type declarations, and `--help` / error output. Measures the bare experience most users actually hit first.

### 2. Isolation — the subject can never touch real machine state

Subjects run on a real developer's machine. Every subject/verifier prompt MUST mandate:

- All work happens inside the workspace directory; nothing is written outside it.
- No touching real credential stores, OS keychains, the real `~/.config`, real cloud accounts, or any shared/system state. Point the tool at an **isolated** home/config inside the workspace (`HOME=<ws>/home`, a `--config-dir`/`*_CONFIG_DIR` override, or the tool's documented equivalent).
- Only obviously-fake placeholder values are ever used as inputs/secrets.
- If a subject cannot find a **documented** way to keep an operation sandboxed, it must STOP before running it and record a blocker — never risk real state to finish a task. (That a tool offers no safe sandbox path is itself a serious finding.)

## Setup responsibility

Before dispatching subjects, the orchestrator identifies the target's actual sandbox mechanism from its docs (the config-dir override, the isolated-home pattern, the in-memory backend, etc.) and bakes the exact command form into every subject prompt. Do not leave "stay sandboxed" as a vague instruction — name the mechanism.

## Why this is strict

A subject that reads source stops being a proxy for a real user — it can no longer find the doc gaps that actually hurt people. A subject that writes to the real keychain can corrupt the host developer's environment. Both failures are silent: the study still produces a report, it is just a false one. Treat any blinding or isolation gap as a defect in the study, not a shortcut.
