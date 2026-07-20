# Intent document — v2 (fixture, INVALID)

> Test fixture: `releases-are-mikes-gate` declares `**Retired**: v5` inside a
> v2 document — a retirement version that doesn't exist yet. Used to test
> `checkRetiredMarkerVersion`'s negative case, and to prove
> `checkNoSlugReuseAcrossVersions` still anchors the retirement to this
> document's own version (v2) rather than trusting the malformed "v5".
>
> **Version**: 2 · **Ratified**: 2026-02-01

## 1. `releases-are-mikes-gate`

**Publishing and releasing are mine alone.**

**Retired**: v5

1. Agents never touch version/release PRs.
2. Agents never publish a package or flip visibility.
