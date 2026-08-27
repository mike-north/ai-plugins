/**
 * attest-it admission gate (docs/toolsmith/attest-it-admission.md
 * §Promotion integration) — project scope only per D-018; user-scope
 * admission is #89-gated and untouched here.
 *
 * Toolsmith ships attest-it CONFIG (a gate + suite scaffolded by
 * `approve --setup`), never attest-it behavior — "nothing toolsmith-specific
 * leaks into attest-it" is the substrate's hard rule. This module talks to
 * attest-it EXCLUSIVELY through its CLI (`attest-it verify --json`, `attest-it
 * run --suite ...`), the same way a human would, and the same way
 * `toolsmith lint`'s shellcheck integration talks to an external tool
 * on PATH: attest-it's programmatic `@attest-it/core` API pulls in `yaml`,
 * whose CJS build esbuild cannot bundle into this package's committed,
 * dependency-free `.mjs` (main.ts's own invariant — "so a marketplace
 * install runs with zero build step and no node_modules"); shelling out
 * avoids that entirely and matches the canon's own mechanics table, which is
 * written entirely in terms of CLI verbs. Requires `attest-it` on PATH,
 * exactly like the human already needs for `attest-it run` itself.
 *
 * The sealed surface is exactly `.claude/toolsmith/` (registry.json + the
 * staging tree) minus history.jsonl, which mutates on every Bash call and
 * would churn the fingerprint on unrelated activity. That directory holds
 * precisely what the canon's "sealed surface" table calls out: the staged
 * bytes and the registry entry's covers/purpose/grants — permissionRule is
 * a pure function of `path`, which is itself covered, so it needs no
 * separate inclusion.
 *
 * Trust boundary (canon §"Trust boundaries, stated honestly", the #149
 * caveat): the published 0.10.1 CLI's `verify` has no `--base` flag, so
 * plain verification trusts the working-tree policy. This module closes the
 * self-enrollment hole for THIS interim period with a signer-fingerprint pin
 * recorded outside `.attest-it/config.yaml` (in `.attest-it/` itself, so it
 * naturally sits outside the sealed `.claude/toolsmith/` surface) at
 * `approve --setup` time — an anchor an agent editing the working tree can't
 * silently rewrite to match its own re-enrollment. `attest-it verify`'s own
 * signature check proves the seal is cryptographically valid against
 * WHATEVER the working tree's config currently says; the pin below proves it
 * is valid against the SAME signer recorded at setup, which a working-tree
 * edit cannot move.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export const ADMISSION_GATE_ID = "toolsmith-admission";
export const ADMISSION_SUITE_NAME = "toolsmith-admission";

export function attestItConfigPath(root: string): string {
  return join(root, ".attest-it", "config.yaml");
}

/** Toolsmith's own signer-fingerprint pin (canon §Trust boundaries item 2).
 * Deliberately NOT under `.claude/toolsmith/` (the sealed surface) — an
 * agent that edits the sealed surface must not be able to move the anchor
 * that surface is checked against. */
export function signerPinPath(root: string): string {
  return join(root, ".attest-it", "toolsmith-admission-signer.json");
}

export interface SignerPin {
  /** Team member slug pinned at `approve --setup` time. */
  slug: string;
  /** Base64 Ed25519 public key pinned at `approve --setup` time. */
  publicKey: string;
  /** ISO 8601 timestamp of when the pin was recorded. */
  pinnedAt: string;
}

export function readSignerPin(root: string): SignerPin | null {
  const path = signerPinPath(root);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Record<string, unknown>)["slug"] === "string" &&
      typeof (parsed as Record<string, unknown>)["publicKey"] === "string" &&
      typeof (parsed as Record<string, unknown>)["pinnedAt"] === "string"
    ) {
      return parsed as SignerPin;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSignerPin(root: string, pin: SignerPin): void {
  const path = signerPinPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pin, null, 2) + "\n", "utf8");
}

/**
 * Extract `team.<slug>.publicKey` from the config.yaml text with a narrow,
 * line-oriented scan — NOT a general YAML parser. This is deliberately
 * minimal: toolsmith only ever needs this one scalar, from a file whose
 * `team:`/per-slug shape `approve --setup` itself writes (see
 * approve-setup.ts's `upsertYamlBlock`); any structural surprise (comments,
 * flow-style mappings, re-ordered keys) fails safe by returning null, which
 * callers treat as "does not match the pin" — refuse, never silently trust.
 */
export function extractTeamPublicKey(yamlText: string, slug: string): string | null {
  const teamMatch = /^team:\s*$/m.exec(yamlText);
  if (!teamMatch) return null;
  const afterTeam = yamlText.slice(teamMatch.index + teamMatch[0].length);
  const lines = afterTeam.split("\n");
  let inEntry = false;
  for (const line of lines) {
    if (line.length > 0 && /^\S/.test(line)) break; // next top-level key — team: section ended
    if (new RegExp(`^ {2}${slug}:\\s*$`).test(line)) {
      inEntry = true;
      continue;
    }
    if (inEntry) {
      if (/^ {2}\S/.test(line)) break; // next team entry started
      const m = /^\s*publicKey:\s*(\S+)\s*$/.exec(line);
      if (m?.[1]) return m[1];
    }
  }
  return null;
}

/**
 * True only when this project has opted INTO the attest-it admission gate:
 * `.attest-it/config.yaml` defines both the gate and the suite AND a signer
 * pin has been recorded. Until `approve --setup` has run, promotion behaves
 * exactly as it did before this feature (today's pin-only ceremony) — this
 * is the "lazy migration" posture the canon's rollout section describes,
 * the same posture the 0555+uchg protection migration used.
 */
export function isAdmissionConfigured(root: string): boolean {
  const configPath = attestItConfigPath(root);
  if (!existsSync(configPath)) return false;
  if (!existsSync(signerPinPath(root))) return false;
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    return false;
  }
  return (
    new RegExp(`^gates:\\n(?:.*\\n)*? {2}${ADMISSION_GATE_ID}:\\s*$`, "m").test(text) &&
    new RegExp(`^suites:\\n(?:.*\\n)*? {2}${ADMISSION_SUITE_NAME}:\\s*$`, "m").test(text)
  );
}

export type AdmissionLoadResult = { ok: true; pin: SignerPin } | { ok: false; reason: string };

/**
 * Load the signer pin (and confirm the gate/suite are still present),
 * fail-closed with a distinct legible reason for each broken shape (AC6).
 * Callers must have already confirmed `isAdmissionConfigured()` — this
 * function still re-validates defensively (a concurrent edit between the
 * two calls).
 */
export function loadAdmissionState(root: string): AdmissionLoadResult {
  if (!isAdmissionConfigured(root)) {
    return {
      ok: false,
      reason: `attest-it admission is not fully configured for this project — run \`toolsmith approve --setup\``,
    };
  }
  const pin = readSignerPin(root);
  if (!pin) {
    return { ok: false, reason: `no signer pin recorded at ${signerPinPath(root)} — run \`toolsmith approve --setup\`` };
  }
  return { ok: true, pin };
}

/** Relative pathspecs the dirty-tree check covers: the sealed surface AND
 * the trust anchor (config + signer pin) — deliberately NOT the whole
 * `.attest-it/` directory, which also holds `attest-it run`'s transient seal
 * output (seals.yaml/seals.json). That file is normally uncommitted at the
 * exact moment SEAL runs (you just ran `attest-it run` a moment before
 * promoting) — including it here would trip a false refusal on every
 * ordinary promotion. */
const CLEAN_TREE_PATHSPECS = [".claude/toolsmith", ".attest-it/config.yaml", ".attest-it/toolsmith-admission-signer.json"];

/**
 * Fail-closed working-tree check (canon §Scope split: "attest-it seals
 * committed content in a clean git tree — it is git-shaped by design"; AC5).
 * Runs BEFORE attest-it is invoked at all, so a dirty tree gets a legible
 * toolsmith-authored message rather than depending on attest-it's own
 * (CLI-only, not exposed by the programmatic surface) dirty-tree refusal.
 *
 * Covers the trust anchor as well as the sealed surface (security finding on
 * PR #147): `checkCleanTree` originally only watched `.claude/toolsmith`,
 * which let an agent edit the signer pin AND `.attest-it/config.yaml`
 * in-place (both uncommitted, so VERIFY's pin check would see them agreeing
 * with each other and pass) — an AC1/AC5 bypass. Both files must now be
 * clean/committed too before SEAL/VERIFY runs at all.
 */
export function checkCleanTree(root: string): { ok: true } | { ok: false; reason: string } {
  const result = spawnSync("git", ["status", "--porcelain", "--", ...CLEAN_TREE_PATHSPECS], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) {
    return { ok: false, reason: `could not check git status: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return { ok: false, reason: `\`git status\` exited ${String(result.status)}: ${result.stderr.trim()}` };
  }
  if (result.stdout.trim().length > 0) {
    return {
      ok: false,
      reason:
        "the sealed surface (.claude/toolsmith/) and/or the admission trust anchor " +
        "(.attest-it/config.yaml, .attest-it/toolsmith-admission-signer.json) has uncommitted " +
        "changes — attest-it seals committed content in a clean git tree, and the trust anchor must " +
        "be just as tamper-evident; commit everything, then re-seal",
    };
  }
  return { ok: true };
}

interface AttestItSeal {
  gateId: string;
  fingerprint: string;
  timestamp: string;
  sealedBy: string;
  signature: string;
}

interface AttestItGateVerifyResult {
  gateId: string;
  state: string;
  seal?: AttestItSeal;
  message?: string;
}

export interface SealCheckOk {
  ok: true;
  fingerprint: string;
  seal: AttestItSeal;
}
export interface SealCheckFail {
  ok: false;
  reason: string;
}
export type SealCheckResult = SealCheckOk | SealCheckFail;

/**
 * VERIFY (canon §Promotion integration step 4): `attest-it verify --json`
 * (signature validity + fingerprint match against the CURRENT working tree)
 * PLUS the signer-fingerprint pin — the interim self-enrollment guard
 * (canon §Trust boundaries item 2, and AC1). Every failure mode returns a
 * distinct, legible reason (AC6); nothing here mutates any state.
 */
export function verifyAdmissionSeal(root: string, pin: SignerPin): SealCheckResult {
  let spawned;
  try {
    spawned = spawnSync("attest-it", ["verify", ADMISSION_GATE_ID, "--json"], {
      cwd: root,
      encoding: "utf8",
    });
  } catch (err) {
    return { ok: false, reason: `could not run attest-it: ${(err as Error).message}` };
  }
  if (spawned.error) {
    const code = (spawned.error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      reason:
        code === "ENOENT"
          ? "attest-it is not installed / not on PATH — install it (npm install -g attest-it) to use the admission gate"
          : `could not run attest-it: ${spawned.error.message}`,
    };
  }
  let parsed: AttestItGateVerifyResult[];
  try {
    parsed = JSON.parse(spawned.stdout) as AttestItGateVerifyResult[];
  } catch (err) {
    return {
      ok: false,
      reason:
        `\`attest-it verify --json\` produced unparseable output: ${(err as Error).message}. ` +
        `stderr: ${spawned.stderr.trim()}`,
    };
  }
  const result = parsed.find((r) => r.gateId === ADMISSION_GATE_ID);
  if (!result) {
    return { ok: false, reason: `attest-it verify returned no result for gate "${ADMISSION_GATE_ID}"` };
  }
  if (result.state === "MISSING") {
    return {
      ok: false,
      reason:
        `no admission seal found for gate "${ADMISSION_GATE_ID}" — a human must run ` +
        `\`attest-it run --suite ${ADMISSION_SUITE_NAME}\` in their own terminal before promotion`,
    };
  }
  if (result.state !== "VALID" || !result.seal) {
    return {
      ok: false,
      reason: `admission seal is ${result.state}${result.message ? `: ${result.message}` : ""} (AC2/AC6)`,
    };
  }
  const seal = result.seal;

  // The load-bearing check for this interim period (AC1): the seal's signer
  // must be the SAME slug AND the SAME public key pinned at `approve
  // --setup`, not merely "whoever the working-tree config currently
  // authorizes". An agent that edits config.yaml to enroll its own identity
  // (new slug, or the same slug pointed at a new key) and re-seals passes
  // plain `attest-it verify` — it does NOT pass this pin check.
  if (seal.sealedBy !== pin.slug) {
    return {
      ok: false,
      reason:
        `admission seal was signed by "${seal.sealedBy}", which does not match the signer pinned at ` +
        `setup ("${pin.slug}") — promotion refuses rather than trust a working-tree-editable enrollment`,
    };
  }
  let configText: string;
  try {
    configText = readFileSync(attestItConfigPath(root), "utf8");
  } catch (err) {
    return { ok: false, reason: `could not re-read attest-it config to verify the pinned signer's key: ${(err as Error).message}` };
  }
  const currentKey = extractTeamPublicKey(configText, pin.slug);
  if (currentKey !== pin.publicKey) {
    return {
      ok: false,
      reason:
        `the "${pin.slug}" team member's public key in .attest-it/config.yaml no longer matches the ` +
        `key pinned at setup — promotion refuses rather than trust a working-tree-editable key swap`,
    };
  }

  return { ok: true, fingerprint: seal.fingerprint, seal };
}

/**
 * Presence-backed private-key reference types (AC3a, #133): documented by
 * attest-it itself (0.10.1) to demand a per-signature human-presence action.
 * "1password": `OnePasswordKeyProvider.getPrivateKey` re-authenticates via a
 * fresh PTY (Touch ID / master password) on every retrieval, per its own
 * doc comment ("this prevents automated agents from using cached
 * credentials"). "yubikey": `YubiKeyProvider` decrypts via HMAC
 * challenge-response, which "requires physical YubiKey presence" on every
 * use, per its own doc comment. "keychain" and "file" are deliberately
 * excluded: attest-it's `FilesystemKeyProvider` and
 * `MacOSKeychainKeyProvider` docs make no claim of a per-use touch/biometric
 * prompt — a keychain item CAN be ACL'd that way, but attest-it's provider
 * doesn't expose or verify that configuration, so it cannot be trusted here.
 */
const PRESENCE_BACKED_KEY_TYPES: ReadonlySet<string> = new Set(["1password", "yubikey"]);

export function isPresenceBackedKeyType(type: string): boolean {
  return PRESENCE_BACKED_KEY_TYPES.has(type);
}
