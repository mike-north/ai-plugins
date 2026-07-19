# Intent document — v2 (fixture)

> Test fixture modeling the intent-document format for
> `intent-format-lint.test.mjs`. Not a real intent document. Amends
> `ssh-always` (new clause 3) and retires `releases-are-mikes-gate`; adds a
> new principle `secrets-stay-in-1password`.
>
> **Version**: 2 · **Ratified**: 2026-02-01

## 1. `ssh-always`

**SSH is always my credential type when engaging with GitHub.**

1. Git remotes use SSH URLs.
2. Switching a remote to HTTPS to make an operation succeed is a violation.
3. Exporting a token scoped to another tool into the environment so git
   picks it up is also a violation.

## 2. `releases-are-mikes-gate`

**Publishing and releasing are mine alone.**

1. Agents never touch version/release PRs.
2. Agents never publish a package or flip visibility.

**Retired**: v2

## 3. `secrets-stay-in-1password`

**Secrets are read only through authorized 1Password accessors.**

1. Never read raw credential values from files, shell history, or
   environment dumps.
