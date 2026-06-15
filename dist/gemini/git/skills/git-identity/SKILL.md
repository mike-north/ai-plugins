---
name: git-identity
description: >-
  Resolve a git remote to an identity — commit author (name/email), optional GPG signing
  key, and arbitrary namespaced key/value fields — and apply it to a repo. Provider-agnostic
  (GitHub/GitLab/Bitbucket/GHE/corp). Use when setting up author/signing per remote, when an
  agent needs a per-identity value (e.g. a GitHub username or auth profile) for another tool,
  or when one machine has multiple git accounts/servers. The SSH key stays owned by ssh config
  (the alias in the remote URL); this owns everything else, keyed on the host.
---

# git-identity

A per-host git identity router. Resolves the **remote** you're working with to an **identity**
and applies it — so author/signing are correct per remote and any tool can read per-identity
values without each reinventing the mapping.

## The model (host is the pivot)

- A folder has one or more **remotes**; each remote is `host + path` over ssh.
- **`host → exactly one SSH key`** — owned by **ssh config** (a `Host` alias's `IdentityFile`,
  or the machine default). This layer does **not** manage keys; the alias in the remote URL
  selects the key.
- **`host → exactly one git identity`** — author + optional gpg key + arbitrary fields. Owned
  **here**. Same join key (host), disjoint ranges → one source of truth per edge, no mixed signals.
- The SSH key and the author/gpg bind at **different times**: the key at *push time, per remote*;
  the author + signature at *commit time, per repo* (one per commit, before any remote is chosen).

## Commands

`git-identity` is on your `PATH` (also works as `git identity <cmd>`):

```
git-identity resolve [--remote <name> | <url>]      # which identity does this remote map to?
git-identity apply  [--identity <name>] [--remote]  # write author/gpg/fields to THIS repo's local config
git-identity field  <key> [--required] [--remote|--identity <name>]   # one field value (exit 3 if unset)
git-identity fields [--identity <name>]             # list the resolved identity's fields
git-identity doctor                                 # diagnose this repo (remotes, identity, conflicts)
git-identity validate                               # check config invariants (+ ssh/gpg best-effort)
```

- `field` prefers the **applied** local config (what `apply` wrote) so a multi-remote repo pinned
  with `--identity` returns the pinned values; it falls back to resolving from the source config.
  It **fails loud on unset** (exit 3, empty stdout) so `tool -u "$(git-identity field …)"` can't
  silently pass `""`; use `--required` to force an error.

## Consumers compose on `field`

The core stores fields but never interprets them — *consumers* do, each owning a namespace:

```bash
gh auth switch -u "$(git-identity field github.username --required)"   # github layer
# graphite, a Claude Code auth wrapper (claude.profile → work API key vs personal sub), etc.
```

Adding a tool's integration = reading a field; the core never changes.

## Config

JSON at `$GIT_IDENTITY_CONFIG`, else `$XDG_CONFIG_HOME/git-identity/config.json`, else
`~/.config/git-identity/config.json`. Identity-keyed, indexed by host (see `config.example.json`):

```json
{
  "identities": {
    "personal": { "author": {"name": "…", "email": "…"},
                  "fields": {"github.username": "…", "claude.profile": "personal"},
                  "hosts": ["github.com", "github-personal", "gitlab.com"] },
    "work":     { "author": {"name": "…", "email": "…@corp"}, "signing_key": "ABC123",
                  "fields": {"github.username": "…"}, "hosts": ["github-work", "ghe.corp"] }
  },
  "default_identity": "personal",
  "on_no_match": "silent"
}
```

`hosts` are the tokens that appear in remotes — ssh `Host` aliases (`github-work`) and/or real
hostnames (`github.com`). Only `apply`/`validate` read this file; everything else reads `git config`.

> **v1 note:** the config is JSON for zero-dependency parsing. A friendlier YAML/TOML authoring
> layer that compiles to this is a planned follow-up; the format is not yet frozen.

## Authoring (build the config)

Discover the inputs deterministically, then associate them:
- SSH keys + `Host` aliases: read `~/.ssh/config` (`Host`, `IdentityFile`, `IdentitiesOnly`).
- GPG signing keys: `gpg --list-secret-keys --keyid-format=long`.
- Existing author config: `git config --get user.email` (global and per-repo).

Map each host to an identity, set `author`/`signing_key`/`fields`, then `git-identity validate`.

## Invariants (`validate`) & guardrails

- Every host appears in **≤ 1 identity** (host-uniqueness).
- Referenced ssh `Host` aliases should set **`IdentitiesOnly yes`** — otherwise ssh may offer
  every agent key and authenticate as the wrong account (the "one key per host" guarantee leaks).
- `signing_key`s exist in the gpg secret keyring (best-effort; skipped if gpg absent).
- `doctor` flags **multi-remote repos that span identities** (author is per-repo → pin one with
  `apply --identity <name>`) and **naked remotes** (real hostname, no alias → ambiguous key).

## Scope

- **In:** host-keyed resolution; author + gpg + arbitrary KV fields → repo-local git config;
  the `field` accessor; multi-remote handling; validation. Provider-agnostic.
- **Out:** does **not** own/generate `~/.ssh/config` (it references it); does not switch `gh`
  accounts (that's a downstream consumer reading `github.username`); does not rewrite history.
