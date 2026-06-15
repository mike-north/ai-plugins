# Encryption and Secrets

Decision guide and implementation patterns for managing secrets in chezmoi dotfiles.

## Two Approaches

### 1. Encrypted-at-Rest (age)

Secrets are encrypted in the git repo using [age](https://age-encryption.org/) and decrypted to plaintext on disk when `chezmoi apply` runs.

**Pros:**
- Simple — works everywhere, including headless servers and containers
- No external service dependency at apply time
- Fast decryption with no network calls

**Cons:**
- Secrets exist in plaintext on disk after apply
- Age key must be present on each machine

**Best for:** Headless environments, CI, SSH dev boxes, or anywhere a secrets backend isn't available.

### 2. Secrets Backend (1Password, Bitwarden, etc.)

Secrets are retrieved from a secrets manager at apply time via chezmoi's template functions (e.g., `onepasswordRead`, `bitwardenFields`).

**Pros:**
- Secrets never touch disk in plaintext
- Centralized secret rotation

**Cons:**
- Requires the backend CLI to be installed and authenticated at apply time
- May not work on headless machines (e.g., 1Password CLI requires setup)
- Network dependency during apply

**Best for:** Desktop machines where the secrets manager is always available.

### Hybrid Approach

Use age for secrets needed on headless machines and a secrets backend for desktop-only secrets. This gives portability where it matters and stronger security where it's available.

## Headless Environment Considerations

Headless environments (SSH dev boxes, CI runners, containers) often lack:
- GUI-based authentication (1Password desktop, browser-based OAuth)
- Persistent login sessions for CLI tools
- Network access to secrets backends

Age encryption works in all of these — it only needs the key file. If your dotfiles must work headless, age should be your primary encryption method, possibly supplemented by a secrets backend on desktop machines.

## Age Encryption Setup

### Generate a key pair

```bash
age-keygen -o ~/.config/chezmoi/key.txt
chmod 600 ~/.config/chezmoi/key.txt
```

The output includes the public key (recipient). Save it — you'll need it in the chezmoi config.

### Configure chezmoi

Add to `.chezmoi.toml.tmpl`:

```toml
[age]
identity = "~/.config/chezmoi/key.txt"
recipient = "age1..."  # your public key from age-keygen
```

### Add encrypted files

```bash
chezmoi add --encrypt ~/.config/some-app/secret.key
```

This creates an `encrypted_` prefixed `.age` file in the source directory.

### Use encrypted values in templates

```
{{ include (joinPath .chezmoi.sourceDir "path/to/encrypted_file.age") | decrypt }}
```

## Key Provisioning Patterns

The age key must exist on each machine before encrypted files can be applied. Common strategies:

### Store the key in a secrets manager

Keep the age private key in 1Password, Bitwarden, or another secrets manager. Write a setup script that retrieves it:

```bash
#!/bin/bash
# Example: retrieve age key from 1Password
mkdir -p ~/.config/chezmoi
op item get "chezmoi age key" --vault "Personal" --fields notesPlain \
  > ~/.config/chezmoi/key.txt
chmod 600 ~/.config/chezmoi/key.txt
```

### Remote provisioning via SSH

Copy the key to headless machines from a machine that already has it:

```bash
#!/bin/bash
# Example: push age key to a remote host
host="$1"
scp ~/.config/chezmoi/key.txt "$host":~/.config/chezmoi/key.txt
ssh "$host" chmod 600 ~/.config/chezmoi/key.txt
```

### Bootstrap flow with conditional ignore

The most robust pattern for new machines:

1. `.chezmoiignore` conditionally skips encrypted files when the key is missing
2. First `chezmoi apply` works without the key — deploys everything except encrypted files
3. A setup script (deployed in step 2) provisions the key
4. Second `chezmoi apply` picks up encrypted files

Example `.chezmoiignore` block:

```
{{- $keyPath := joinPath .chezmoi.homeDir ".config/chezmoi/key.txt" -}}
{{- $validKey := false -}}
{{- if stat $keyPath -}}
{{-   $validKey = include $keyPath | contains "AGE-SECRET-KEY-" -}}
{{- end }}
{{ if not $validKey }}
# Files that require decryption — skipped until key is provisioned
path/to/encrypted/files/
{{ end }}
```

This pattern ensures `chezmoi apply` never fails on a fresh machine, even before secrets are available.

## 1Password Integration Patterns

If using 1Password as a secrets backend or for key provisioning:

### Retrieving secrets in templates

```
{{ onepasswordRead "op://vault/item/field" }}
```

### Retrieving secrets in setup scripts

```bash
op item get "item name" --vault "vault name" --fields fieldName
```

### Conventions
- Use descriptive item names (e.g., "chezmoi age key", "GitHub token for dotfiles")
- Store multi-line secrets (like age keys) in the "notes" field of a Secure Note
- Use `--fields notesPlain` to retrieve the notes field via CLI

### Authentication considerations
- `op` CLI requires `eval $(op signin)` or biometric unlock before use
- Service accounts (`OP_SERVICE_ACCOUNT_TOKEN`) work in headless environments but have limited vault access
- If `op` is unavailable, the bootstrap flow with conditional ignore (above) lets the machine work without it
