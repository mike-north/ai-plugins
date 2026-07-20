# Toolsmith PRFAQ

Mike North · 2026-07-15 · Draft for internal review

> **Scope note (added 2026-07-19).** Predates toolsmith's narrowing
> ([toolsmith-narrowed](../harness-program/toolsmith-narrowed.md)). Answers about forging, signing,
> review fatigue, and the two archetypes remain **governing**. Answers about blocking/redirect
> behavior and telemetry describe **command steering** and are superseded →
> [`docs/command-steering/`](../command-steering/). See the [canon map](./README.md).

---

## Press release

### Toolsmith lets coding agents forge their own tools — and lets you approve them once, with a YubiKey tap, instead of approving dangerous commands forever

**Toolsmith is an agent-harness plugin that turns permission fatigue into a self-improving toolbox.** When an agent repeatedly needs a command you've marked as requiring per-use approval — `gh api`, `curl`, `aws` — Toolsmith notices the pattern, spawns a sub-agent to forge a narrow, guarded script that does exactly that job safely, and presents it to you for a single cryptographic sign-off. From then on, the agent runs the forged tool autonomously, and the raw dangerous command stays gated.

Today, working with an agent means an unpleasant choice: grant broad access to powerful commands and hope for the best, or approve every invocation by hand and become the bottleneck in your own automation. Neither scales. The approvals are unreviewable in aggregate — nobody can meaningfully evaluate the 40th `gh api` GraphQL query of the day — and the fatigue trains you to rubber-stamp exactly when you shouldn't.

Toolsmith changes the unit of approval from the *invocation* to the *contract*. A forged tool like `gh-merge` merges a pull request only when all review threads are resolved, a Copilot review is present, every CI check passes (required or not), api-extractor reports no public API change, and the commit history is free of agent-attribution footers. Each guard runs inside the tool, atomically, with its own named exit code. You read the contract once, tap your YubiKey to sign the script's hash, and choose the grant terms: which agents (by session or agent type), for how long. If the script ever changes by a single byte, the signature fails and the tool leaves the toolbox until you re-sign.

Meanwhile, Toolsmith's hooks steer without blocking. When an agent reaches for a raw dangerous command, the pre-tool hook tells it the true cost — "this requires human approval on every use, and something similar has run 42 times in the last six hours" — and lets the agent decide whether to spawn the forge. When a forged tool already covers the pattern, the hook redirects to it. Every invocation, redirect, and ask is logged, and a curator sub-agent uses that telemetry to propose new tools, modify existing ones, and keep the catalog discoverable.

Forged tools ship with a small SDK — agent detection, timeout enforcement, token-efficient TOON output with JSON for composition, a help formatter, dependency declarations that double as a machine-installable manifest — and every proposal must pass a static-analysis gate before it's even eligible for signing, so your review time is spent on the one question machines can't answer: *do I want an agent to have this capability?*

"The first two days, the forge runs hot," said Mike North, Toolsmith's creator. "After that it goes quiet — the toolbox covers your real workflows, your agents stop asking, and the only things still hitting the approval prompt are the genuine one-offs. Which is exactly where human judgment belongs."

Toolsmith is designed for a single power user and their fleet of agents. It integrates with Claude Code hooks and permissions today, stores signing keys and grants via vaultkeeper (YubiKey, 1Password, macOS Keychain, Bitwarden), and syncs cleanly with dotfile managers so a new machine bootstraps the entire signed toolbox with one preflight check.

---

## FAQ

**Q: Why not just block dangerous commands outright?**
Because occasional exotic use is legitimate — flipping a branch-protection rule once is not worth a dedicated tool. Blocking punishes the long tail; surfacing cost lets the agent route the recurring head into forged tools while the tail stays on the (appropriate) human-approval path. *Hard* blocking is reserved for redirects, where a forged tool demonstrably covers the pattern. A command you've marked `ask` that no tool covers gets a *soft* block instead — a `deny` the agent can override with a deliberate `# toolsmith:proceed` marker that falls back to your normal approval — so the nudge toward forging lands without stranding a genuine one-off, and a truly novel command is never blocked at all.

**Q: What stops an agent from approving its own tools, or editing a tool after approval?**
Two mechanisms. Signing requires a human physical action (YubiKey tap / 1Password unlock) via vaultkeeper — the private key is never available to the agent. And approval binds to the content hash: any modification invalidates the signature, and the PreToolUse hook verifies the resolved script's hash on every invocation, so PATH shadowing and post-hoc edits both fail closed to the normal ask flow.

**Q: How is this different from just writing good CLI wrappers by hand (e.g. github-fleet-tools)?**
github-fleet-tools is the proof of concept — five hand-designed, allowlistable tools. Toolsmith generalizes it: the *agent* notices the pattern, the *agent* drafts the tool against enforced design patterns, a linter verifies the contract mechanically, and the human's role compresses to judgment plus a signature. Hand-tooling doesn't scale past the tools you personally think to build.

**Q: Isn't reviewing agent-written shell scripts its own fatigue problem?**
It would be, without the gate. Proposals must pass shellcheck plus the forge rule pack (dependencies declared and true, guards mapped to exit codes, no interactivity, no dynamic invocation, no secret flags, timeouts on anything that can hang) before a human sees them. The scripts are also structurally small — thin guard logic over a signed SDK — and any lint exception must appear as a visible, reasoned disable comment *inside the hashed script*. Review is short because the format makes dishonesty hard.

**Q: What are the two "tool archetypes"?**
**Precondition tools** encode *when* an action may fire (`gh-merge`: seven verifiable guards). **Authority tools** encode *what* a role may assert (`gh-product-sign-off`: flip exactly one named GitHub check to pass, one direction only, `--rationale` required and posted). Precondition tools earn autonomy through verification; authority tools delegate judgment through narrowing. Nearly every dangerous capability an agent wants falls into one of the two shapes.

**Q: Why session- and agent-type-scoped grants?**
Because "who may do this" is organizational design. Grants key off the `session_id` and `agent_type` fields present in hook payloads, so you can express "code-reviewer agents may merge; the orchestrator that wrote the code may not" — structural separation of duties. Session grants also die naturally with the conversation (`/clear` starts a new session), which bounds trust to the context that justified it.

**Q: What happens on a brand-new machine?**
Dotfiles sync brings the signed toolbox, the manifest, and the plugin. A one-time preflight walks the dependency manifest (`jq`, `gh`, `toon`, …, each with an optional annotated minimum version), reports what's missing with the exact install command, and degrades partially — 28 of 30 tools work immediately while the odd upgrade happens whenever. No per-invocation checks, ever.

**Q: Does Toolsmith phone home?**
No. The telemetry (invocations, outputs, redirects, blocks) is local, and it's load-bearing product surface — it's what the curator reads to propose tools — not analytics.

**Q: What is explicitly out of scope for v1?**
Multi-user/team tool sharing and graduation between project and user scopes; audit-grade provenance of which tool version informed which agent decision; back-pressure on proposal volume. Each is real; each is earned later. v1 makes one user's loop excellent.

**Q: What does failure look like?**
Agents keep reaching for raw commands because forged tools aren't discoverable (semantic activation failure), or humans start rubber-stamping proposals because the lint gate lets sloppy scripts through (review-fatigue relocation), or the curator produces over-scoped tools that recreate the broad-access problem with extra steps. All three are measurable from the telemetry triangle, which is why it exists.
