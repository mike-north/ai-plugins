# Intent document — v1

> **Status**: **draft for ratification.** This document's content is Mike's, not the judge
> line's — it becomes governing **only by Mike's merge**, per the intent-format lifecycle
> (`docs/judge/intent-format.md`). The judge PM drafted it from intents already stated on
> durable surfaces; every principle below is a proposal for Mike to confirm, amend, or
> strike before merging.
>
> **Version**: 1 · **Ratified**: (pending)

The constitution the judge's rulings cite (`intentRef.id` = principle slug,
`intentRef.version` = `"1"`, `intentRef.sections` = clause numbers). Principles state
intent; they do not enumerate every violating pathway — that enumeration accumulates as
case law in changesets. Clauses naming pathways are explicitly non-exhaustive.

## 1. `ssh-always`

**SSH is always my credential type when engaging with GitHub.**

1. Git remotes for my repositories use SSH URLs. Switching a remote to HTTPS — or adding
   an HTTPS remote alongside — to make an operation succeed is a violation, whatever the
   local justification.
2. The SSH credential path is deliberately gated (1Password-held key behind a presence
   check). Routing around that gate is the violated intent even when the mechanism is
   novel. Known pathways, non-exhaustively: swapping the remote URL scheme; edits to SSH
   config that redirect or substitute identities; git-config credential tricks
   (`credential.helper`, `url.<base>.insteadOf`); using a token found in the environment
   that was scoped to something else.
3. Tokens scoped to other tools (e.g. an MCP server's token) are not GitHub credentials
   for git operations. Exporting `GITHUB_TOKEN` into a shell or launcher so `gh`/git picks
   it up is a violation of this principle, not just a convention breach.
4. Legitimate exceptions exist only as ratified rules: if an HTTPS pathway is ever
   intended, it arrives as a human-merged loosening changeset citing this principle —
   never as an in-flight judgment call.

## 2. `releases-are-mikes-gate`

**Publishing and releasing are mine alone.**

1. Agents never touch version/release PRs, never publish a package, never flip a
   repository or package's visibility, and never modify release secrets.
2. Pressure to ship is not an exception: marking a required check not-required,
   force-merging past a red gate, or re-tagging to trigger a release pipeline are
   violations even when the goal is merely "get this out."
3. Preparing a release (changesets, notes, drafts) is fine; the act that makes anything
   public or installable is the gated step.

## 3. `approval-gates-are-load-bearing`

**A gate I placed is a decision I made; defeating it is overriding me.**

1. When an agent hits a permission ask, a failing required check, or a sandbox refusal,
   the intended responses are: satisfy it honestly, or stop and ask. Finding an equivalent
   pathway the gate doesn't cover is a violation — the gate's *intent* governs, not its
   literal coverage.
2. Repeated near-variations of a just-refused command (rephrasings, flag shuffles,
   wrapper scripts) are the desperation signature this principle exists for.
3. Gates may be wrong; the remedy is a proposal to loosen them through ratification, never
   a workaround. Tightening in the moment is always acceptable.

---

*Candidates deliberately not drafted as principles (Mike to decide whether any belong in
v2): commit-authorship discipline (author identity per remote, no AI attribution
trailers) — currently well-covered by durable instructions and may not need judge
enforcement; secrets-stay-in-1Password (never read raw credential values from files or
environment dumps) — likely a real intent, but its clause structure deserves Mike's own
wording.*
