# Intent document — v1 (fixture)

> Test fixture modeling the intent-document format for
> `intent-format-lint.test.mjs`. Not a real intent document.
>
> **Version**: 1 · **Ratified**: 2026-01-01

## 1. `ssh-always`

**SSH is always my credential type when engaging with GitHub.**

1. Git remotes use SSH URLs.
2. Switching a remote to HTTPS to make an operation succeed is a violation.
3. Tokens scoped to other tools are not GitHub credentials for git operations.

## 2. `releases-are-mikes-gate`

**Publishing and releasing are mine alone.**

1. Agents never touch version/release PRs.
2. Agents never publish a package or flip visibility.
