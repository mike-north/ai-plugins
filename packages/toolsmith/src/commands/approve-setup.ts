/**
 * `toolsmith approve --setup` — one-time (idempotent) scaffolding of the
 * attest-it admission gate for THIS project (docs/toolsmith/
 * attest-it-admission.md §Migration and rollout: "One-time setup per
 * scope... Shipped as an `approve --setup`... never run silently"). Project
 * scope only (D-018) — there is no `--user` form.
 *
 * What it does, idempotently:
 *   1. Resolve the local machine's active attest-it identity.
 *   2. Refuse (AC3a, #133) unless that identity's private key is backed by
 *      a provider that demands a per-signature human-presence action
 *      (1Password / YubiKey) — never filesystem/keychain.
 *   3. Write/merge `.attest-it/config.yaml`: a team entry for the identity,
 *      the `toolsmith-admission` gate (fingerprint over `.claude/toolsmith/`,
 *      authorizedSigners: [that identity]), and the `toolsmith-admission`
 *      suite (gate: toolsmith-admission, command: re-lint every staged
 *      draft — the same proposal gate `approve` enforces).
 *   4. Record the signer-fingerprint pin at
 *      `.attest-it/toolsmith-admission-signer.json` — the interim
 *      self-enrollment guard (canon §Trust boundaries item 2) used by
 *      `verifyAdmissionSeal` until attest-it's published CLI exposes
 *      `verify --base` (attest-it#151).
 *
 * Never widens an existing pin: re-running after a DIFFERENT identity
 * became active refuses rather than silently re-pinning — that is a human
 * decision (rotate the signer explicitly), not an automatic side effect of
 * re-running setup.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ADMISSION_GATE_ID,
  ADMISSION_SUITE_NAME,
  attestItConfigPath,
  isPresenceBackedKeyType,
  readSignerPin,
  signerPinPath,
  writeSignerPin,
} from "../lib/attestation.js";

export interface ApproveSetupOptions {
  root: string;
}

function defaultConfigYaml(): string {
  return `version: 1
settings:
  maxAgeDays: 365
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json
  sealsPath: .attest-it/seals.yaml
team: {}
gates: {}
suites: {}
`;
}

/** True when the top-level `${key}:` section already has a `  ${slug}:`
 * entry — scoped to that section only, so a slug string that happens to
 * match another section's key (e.g. the gate and suite here share the
 * literal id "toolsmith-admission") can never cause a false "already
 * present". */
function yamlSectionHasEntry(yamlText: string, key: "team" | "gates" | "suites", slug: string): boolean {
  const keyMatch = new RegExp(`^${key}:.*$`, "m").exec(yamlText);
  if (!keyMatch) return false;
  const after = yamlText.slice(keyMatch.index + keyMatch[0].length);
  for (const line of after.split("\n")) {
    if (line.length > 0 && /^\S/.test(line)) break; // next top-level key — section ended
    if (new RegExp(`^ {2}${slug}:\\s*$`).test(line)) return true;
  }
  return false;
}

/** Minimal, dependency-free YAML *rewriting* of exactly the shapes this
 * command needs to add — never a general YAML writer. This is deliberately
 * narrow: it string-splices into the three top-level keys `team:`, `gates:`,
 * and `suites:` this file itself always creates with `defaultConfigYaml()`
 * or that an `attest-it init`-produced config already has at the top
 * level, per attest-it's own documented config shape. */
function upsertYamlBlock(yamlText: string, key: "team" | "gates" | "suites", slug: string, block: string): string {
  const lines = yamlText.split("\n");
  const keyLineIdx = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: {}`));
  // Body lines sit one level under `  <slug>:`, so they need 4-space indent.
  const indented = block
    .split("\n")
    .map((l) => (l.length > 0 ? `    ${l}` : l))
    .join("\n");
  const entry = `  ${slug}:\n${indented}`;
  if (keyLineIdx === -1) {
    return yamlText.trimEnd() + `\n${key}:\n${entry}\n`;
  }
  if (lines[keyLineIdx] === `${key}: {}`) {
    lines[keyLineIdx] = `${key}:`;
    lines.splice(keyLineIdx + 1, 0, entry);
    return lines.join("\n");
  }
  // Find end of this top-level block (next non-indented, non-blank line).
  let end = keyLineIdx + 1;
  while (end < lines.length && (lines[end] === "" || /^\s/.test(lines[end] ?? ""))) end++;
  lines.splice(end, 0, entry);
  return lines.join("\n");
}

export async function runApproveSetup({ root }: ApproveSetupOptions): Promise<number> {
  let attestIt: typeof import("attest-it");
  try {
    // Dynamic + external (scripts/build.mjs): this is the one place in the
    // CLI that touches attest-it's programmatic API — see lib/attestation.ts
    // and scripts/build.mjs's `external` comment for why.
    attestIt = await import("attest-it");
  } catch (err) {
    process.stderr.write(
      `Error: could not load the \`attest-it\` library (${(err as Error).message}). This installation ` +
        `of toolsmith cannot resolve it from node_modules. Either run \`toolsmith approve --setup\` from ` +
        `an npm-installed @mike-north/toolsmith (which declares attest-it as a dependency), or hand-author ` +
        `.attest-it/config.yaml per docs/toolsmith/attest-it-admission.md and ` +
        `plugins/toolsmith/skills/toolsmith/references/registry-schema.md. Nothing written.\n`,
    );
    return 1;
  }
  const { getActiveIdentity, loadLocalConfigSync } = attestIt;
  let local;
  try {
    local = loadLocalConfigSync();
  } catch (err) {
    process.stderr.write(
      `Error: could not read the local attest-it identity config: ${(err as Error).message}. Run ` +
        `\`attest-it identity create\` first. Nothing written.\n`,
    );
    return 1;
  }
  if (!local) {
    process.stderr.write(
      `Error: no attest-it identity found. Run \`attest-it identity create\` (as the human who will ` +
        `seal admissions), then re-run \`toolsmith approve --setup\`. Nothing written.\n`,
    );
    return 1;
  }
  const identity = getActiveIdentity(local);
  if (!identity) {
    process.stderr.write(
      `Error: attest-it has no ACTIVE identity (local config's activeIdentity does not resolve). Run ` +
        `\`attest-it identity use <slug>\`. Nothing written.\n`,
    );
    return 1;
  }

  // AC3a (#133): the identity MUST demand a per-signature human-presence
  // action. A key that signs from an unlocked session with no interaction
  // does not satisfy admission — refuse it here, at setup, rather than
  // silently accepting a weaker identity.
  if (!isPresenceBackedKeyType(identity.privateKey.type)) {
    process.stderr.write(
      `Error: the active attest-it identity "${identity.name}" is backed by a ` +
        `"${identity.privateKey.type}" key, which does not demand a per-signature human-presence ` +
        `action (hardware touch / biometric) on every use. Admission requires 1Password or YubiKey ` +
        `identities (attest-it's own docs: 1Password re-authenticates via a fresh PTY on every ` +
        `retrieval; YubiKey requires the physical device on every decrypt). Create a presence-backed ` +
        `identity and re-run \`toolsmith approve --setup\`. Nothing written.\n`,
    );
    return 1;
  }

  const existingPin = readSignerPin(root);
  if (existingPin && (existingPin.slug !== identity.name || existingPin.publicKey !== identity.publicKey)) {
    process.stderr.write(
      `Error: this project already has a signer pinned ("${existingPin.slug}"), which differs from ` +
        `the active attest-it identity ("${identity.name}"). Rotating the admission signer is a human ` +
        `decision: remove ${signerPinPath(root)} explicitly first if this rotation is intended. ` +
        `Nothing written.\n`,
    );
    return 1;
  }

  const configPath = attestItConfigPath(root);
  mkdirSync(dirname(configPath), { recursive: true });
  let yamlText = existsSync(configPath) ? readFileSync(configPath, "utf8") : defaultConfigYaml();

  const notes: string[] = [];

  if (!yamlSectionHasEntry(yamlText, "team", identity.name)) {
    yamlText = upsertYamlBlock(
      yamlText,
      "team",
      identity.name,
      [
        `name: ${identity.name}`,
        ...(identity.email ? [`email: ${identity.email}`] : []),
        ...(identity.github ? [`github: ${identity.github}`] : []),
        `publicKey: ${identity.publicKey}`,
        `publicKeyAlgorithm: ed25519`,
      ].join("\n"),
    );
    notes.push(`Added team member "${identity.name}" to ${configPath}.`);
  }

  if (!yamlSectionHasEntry(yamlText, "gates", ADMISSION_GATE_ID)) {
    yamlText = upsertYamlBlock(
      yamlText,
      "gates",
      ADMISSION_GATE_ID,
      [
        `name: Toolsmith admission`,
        `description: Cryptographic admission gate for staged toolsmith tools (docs/toolsmith/attest-it-admission.md)`,
        `authorizedSigners:`,
        `  - ${identity.name}`,
        `fingerprint:`,
        `  paths:`,
        `    - .claude/toolsmith`,
        `  exclude:`,
        `    - "**/history.jsonl"`,
        `    - "**/*.local.*"`,
        `maxAge: 365d`,
      ].join("\n"),
    );
    notes.push(`Added gate "${ADMISSION_GATE_ID}" to ${configPath}.`);
  }

  if (!yamlSectionHasEntry(yamlText, "suites", ADMISSION_SUITE_NAME)) {
    yamlText = upsertYamlBlock(
      yamlText,
      "suites",
      ADMISSION_SUITE_NAME,
      [
        `gate: ${ADMISSION_GATE_ID}`,
        `description: Re-lints every staged draft with the same proposal gate \`toolsmith approve\` enforces`,
        `command: for f in .claude/toolsmith/staging/*; do [ -f "$f" ] && toolsmith lint "$f" || true; done`,
        `interactive: true`,
      ].join("\n"),
    );
    notes.push(`Added suite "${ADMISSION_SUITE_NAME}" to ${configPath}.`);
  }

  writeFileSync(configPath, yamlText.endsWith("\n") ? yamlText : yamlText + "\n", "utf8");

  if (!existingPin) {
    writeSignerPin(root, {
      slug: identity.name,
      publicKey: identity.publicKey,
      pinnedAt: new Date().toISOString(),
    });
    notes.push(`Pinned signer "${identity.name}" at ${signerPinPath(root)}.`);
  }

  if (notes.length === 0) {
    process.stdout.write(
      `Admission already configured for signer "${identity.name}" — nothing to do (idempotent).\n`,
    );
    return 0;
  }

  process.stdout.write(
    [
      ...notes,
      "",
      "Admission is now configured for this project. Every future `toolsmith approve` run for a",
      "project-scope tool will require a valid attest-it seal from the pinned signer before",
      "promotion — commit the staged draft and registry entry, then run",
      `\`attest-it run --suite ${ADMISSION_SUITE_NAME}\` yourself (in your own terminal) before approving.`,
    ].join("\n") + "\n",
  );
  return 0;
}
