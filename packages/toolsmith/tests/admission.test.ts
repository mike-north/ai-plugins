/**
 * Regression tests for the attest-it admission gate wired into `toolsmith
 * approve` (docs/toolsmith/attest-it-admission.md §Promotion integration,
 * project scope per D-018 — issue #76).
 *
 * Test-to-acceptance-criteria mapping (see the doc's §Acceptance criteria):
 *   AC1 (agent cannot self-admit)        -> manual-test-design (real presence
 *                                            hardware needed); this suite DOES
 *                                            cover the pin-rejection MECHANISM
 *                                            (a synthetic identity's seal is
 *                                            refused even though plain
 *                                            attest-it verify would call it
 *                                            valid) in "AC1 mechanism:" below.
 *   AC2 (seal spans the full surface)    -> "AC2:" cases
 *   AC3/AC3a/AC3b (presence, per-signature,
 *     agent-never-intermediary)          -> manual-test-design (real hardware
 *                                            / a real second terminal)
 *   AC4 (lockout stays dead)             -> "AC4:" case
 *   AC5 (dirty-tree refusal)             -> "AC5:" case
 *   AC6 (fail-closed, distinct errors)   -> "AC6:" cases
 *
 * Projects that have never run `approve --setup` are entirely unaffected
 * (today's pin-only ceremony) — "not configured:" cases pin that down.
 *
 * @see docs/toolsmith/attest-it-admission.md
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateEd25519KeyPair } from "attest-it";
import {
  attestItAvailableInTests,
  cleanupTmpDirs,
  gitCommitAll,
  newDraftTool,
  newProj,
  runCli,
  sealAdmission,
  writeAdmissionFixture,
  writeProjectRegistry,
  writeStaged,
} from "./helpers.js";

afterAll(cleanupTmpDirs);

const HAS_ATTEST_IT = attestItAvailableInTests();
const maybeDescribe = HAS_ATTEST_IT ? describe : describe.skip;

const DRAFT = "#!/bin/bash\necho hi\n";

maybeDescribe("attest-it admission gate", () => {
  it("not configured: promotion proceeds exactly as before (no .attest-it/ anywhere)", () => {
    const proj = newProj();
    writeStaged(proj, "foo.sh", DRAFT);
    writeProjectRegistry(proj, [newDraftTool("foo.sh")]);
    gitCommitAll(proj);
    const r = runCli(["approve", "scripts/agent-tools/foo.sh"], { proj });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/admission/i);
    expect(existsSync(join(proj, "scripts", "agent-tools", "foo.sh"))).toBe(true);
  });

  it("happy path: a valid, freshly-sealed admission promotes and reports the seal", () => {
    const proj = newProj();
    writeStaged(proj, "foo.sh", DRAFT);
    writeProjectRegistry(proj, [newDraftTool("foo.sh")]);
    gitCommitAll(proj);
    const fixture = writeAdmissionFixture(proj);
    gitCommitAll(proj, "admission config");
    sealAdmission(proj, fixture);

    const r = runCli(["approve", "scripts/agent-tools/foo.sh"], {
      proj,
      env: { TOOLSMITH_ATTEST_IT_POLL_MS: "10", TOOLSMITH_ATTEST_IT_POLL_ATTEMPTS: "1" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Admission sealed and verified/);
    expect(existsSync(join(proj, "scripts", "agent-tools", "foo.sh"))).toBe(true);
  });

  it("AC2: editing the staged draft after sealing voids admission — promotion refuses, nothing written", () => {
    const proj = newProj();
    writeStaged(proj, "foo.sh", DRAFT);
    writeProjectRegistry(proj, [newDraftTool("foo.sh")]);
    gitCommitAll(proj);
    const fixture = writeAdmissionFixture(proj);
    gitCommitAll(proj, "admission config");
    sealAdmission(proj, fixture);

    // Edit the staged draft AFTER sealing, and commit (so the tree is clean
    // again — isolating the fingerprint-mismatch failure from AC5's).
    writeStaged(proj, "foo.sh", DRAFT + "echo edited-after-seal\n");
    gitCommitAll(proj, "edit after seal");

    const r = runCli(["approve", "scripts/agent-tools/foo.sh"], {
      proj,
      env: { TOOLSMITH_ATTEST_IT_POLL_MS: "10", TOOLSMITH_ATTEST_IT_POLL_ATTEMPTS: "1" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FINGERPRINT_MISMATCH/);
    expect(existsSync(join(proj, "scripts", "agent-tools", "foo.sh"))).toBe(false);
  });

  it("AC2: editing the registry entry's covers after sealing voids admission", () => {
    const proj = newProj();
    writeStaged(proj, "foo.sh", DRAFT);
    writeProjectRegistry(proj, [newDraftTool("foo.sh")]);
    gitCommitAll(proj);
    const fixture = writeAdmissionFixture(proj);
    gitCommitAll(proj, "admission config");
    sealAdmission(proj, fixture);

    writeProjectRegistry(proj, [{ ...newDraftTool("foo.sh"), covers: ["a\\s+much\\s+wider\\s+pattern.*"] }]);
    gitCommitAll(proj, "widen covers after seal");

    const r = runCli(["approve", "scripts/agent-tools/foo.sh"], {
      proj,
      env: { TOOLSMITH_ATTEST_IT_POLL_MS: "10", TOOLSMITH_ATTEST_IT_POLL_ATTEMPTS: "1" },
    });
    expect(r.status).toBe(1);
    expect(existsSync(join(proj, "scripts", "agent-tools", "foo.sh"))).toBe(false);
  });

  it("AC4: a voided seal on a REVISION never interrupts the already-live tool", () => {
    const proj = newProj();
    // First promotion: seal, promote, tool goes live.
    writeStaged(proj, "foo.sh", DRAFT);
    writeProjectRegistry(proj, [newDraftTool("foo.sh")]);
    gitCommitAll(proj);
    const fixture = writeAdmissionFixture(proj);
    gitCommitAll(proj, "admission config");
    sealAdmission(proj, fixture);
    const first = runCli(["approve", "scripts/agent-tools/foo.sh"], {
      proj,
      env: { TOOLSMITH_ATTEST_IT_POLL_MS: "10", TOOLSMITH_ATTEST_IT_POLL_ATTEMPTS: "1" },
    });
    expect(first.status).toBe(0);
    const liveBefore = readFileSync(join(proj, "scripts", "agent-tools", "foo.sh"), "utf8");

    // Stage a revision, but do NOT re-seal (or seal, then edit again) —
    // promotion of the revision must refuse without touching the live file.
    writeStaged(proj, "foo.sh", DRAFT + "echo revision\n");
    const reg = JSON.parse(readFileSync(join(proj, ".claude", "toolsmith", "registry.json"), "utf8")) as {
      tools: Array<Record<string, unknown>>;
    };
    reg.tools[0]!["staged"] = { path: ".claude/toolsmith/staging/foo.sh", note: "revision" };
    writeFileSync(join(proj, ".claude", "toolsmith", "registry.json"), JSON.stringify(reg, null, 2) + "\n");
    gitCommitAll(proj, "stage a revision, unsealed");

    const second = runCli(["approve", "scripts/agent-tools/foo.sh"], {
      proj,
      env: { TOOLSMITH_ATTEST_IT_POLL_MS: "10", TOOLSMITH_ATTEST_IT_POLL_ATTEMPTS: "1" },
    });
    expect(second.status).toBe(1);
    // Live is untouched — still serving the FIRST promotion's content.
    expect(readFileSync(join(proj, "scripts", "agent-tools", "foo.sh"), "utf8")).toBe(liveBefore);
  });

  it("AC5: a dirty sealed surface refuses promotion with a distinct message, nothing written", () => {
    const proj = newProj();
    writeStaged(proj, "foo.sh", DRAFT);
    writeProjectRegistry(proj, [newDraftTool("foo.sh")]);
    gitCommitAll(proj);
    const fixture = writeAdmissionFixture(proj);
    gitCommitAll(proj, "admission config");
    sealAdmission(proj, fixture);

    // Dirty the sealed surface WITHOUT committing.
    writeStaged(proj, "foo.sh", DRAFT + "echo dirty\n");

    const r = runCli(["approve", "scripts/agent-tools/foo.sh"], { proj });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/uncommitted changes/);
    expect(existsSync(join(proj, "scripts", "agent-tools", "foo.sh"))).toBe(false);
  });

  it("AC1/AC5: an uncommitted edit to the signer PIN file refuses promotion (trust anchor, not just the sealed surface)", () => {
    const proj = newProj();
    writeStaged(proj, "foo.sh", DRAFT);
    writeProjectRegistry(proj, [newDraftTool("foo.sh")]);
    gitCommitAll(proj);
    const fixture = writeAdmissionFixture(proj);
    gitCommitAll(proj, "admission config");
    sealAdmission(proj, fixture);

    // An agent edits the PIN file in place (e.g. to point at a key it
    // controls) WITHOUT committing — this must refuse before SEAL/VERIFY
    // ever runs, not merely happen to be caught by the pin mismatch check.
    writeFileSync(
      join(proj, ".attest-it", "toolsmith-admission-signer.json"),
      JSON.stringify({ slug: "agent-evil", publicKey: "not-a-real-key", pinnedAt: "2024-01-15T10:30:00.000Z" }, null, 2),
    );

    const r = runCli(["approve", "scripts/agent-tools/foo.sh"], { proj });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/trust anchor/);
    expect(existsSync(join(proj, "scripts", "agent-tools", "foo.sh"))).toBe(false);
  });

  it("AC1/AC5: an uncommitted edit to .attest-it/config.yaml refuses promotion", () => {
    const proj = newProj();
    writeStaged(proj, "foo.sh", DRAFT);
    writeProjectRegistry(proj, [newDraftTool("foo.sh")]);
    gitCommitAll(proj);
    const fixture = writeAdmissionFixture(proj);
    gitCommitAll(proj, "admission config");
    sealAdmission(proj, fixture);

    // An agent widens authorizedSigners / enrolls its own key in config.yaml
    // WITHOUT committing.
    const configPath = join(proj, ".attest-it", "config.yaml");
    writeFileSync(configPath, readFileSync(configPath, "utf8") + "\n# tampered\n");

    const r = runCli(["approve", "scripts/agent-tools/foo.sh"], { proj });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/trust anchor/);
    expect(existsSync(join(proj, "scripts", "agent-tools", "foo.sh"))).toBe(false);
  });

  it("AC6: a missing seal refuses with a distinct message naming the seal command", () => {
    const proj = newProj();
    writeStaged(proj, "foo.sh", DRAFT);
    writeProjectRegistry(proj, [newDraftTool("foo.sh")]);
    gitCommitAll(proj);
    writeAdmissionFixture(proj);
    gitCommitAll(proj, "admission config, never sealed");

    const r = runCli(["approve", "scripts/agent-tools/foo.sh"], {
      proj,
      env: { TOOLSMITH_ATTEST_IT_POLL_MS: "10", TOOLSMITH_ATTEST_IT_POLL_ATTEMPTS: "1" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/attest-it run --suite toolsmith-admission/);
  });

  it("AC6 / AC1 mechanism: a seal from a signer NOT matching the setup-time pin is refused, even though it is cryptographically valid", () => {
    const proj = newProj();
    writeStaged(proj, "foo.sh", DRAFT);
    writeProjectRegistry(proj, [newDraftTool("foo.sh")]);
    gitCommitAll(proj);
    const fixture = writeAdmissionFixture(proj, "testhuman");
    gitCommitAll(proj, "admission config");

    // Simulate the self-enrollment attack the pin exists to close: a SECOND,
    // synthetic identity is added to the working tree's config and widened
    // into authorizedSigners, then seals with its OWN (real, valid) key.
    // Plain attest-it verify would call this VALID; the pin must still
    // refuse it.
    const evilKeyPair = generateEd25519KeyPair();
    const configPath = join(proj, ".attest-it", "config.yaml");
    let cfg = readFileSync(configPath, "utf8");
    cfg = cfg.replace("authorizedSigners:\n      - testhuman", "authorizedSigners:\n      - testhuman\n      - agent-evil");
    cfg += `  agent-evil:\n    name: agent-evil\n    publicKey: ${evilKeyPair.publicKey}\n    publicKeyAlgorithm: ed25519\n`;
    writeFileSync(configPath, cfg);
    gitCommitAll(proj, "self-enrollment attempt");

    sealAdmission(proj, { slug: "agent-evil", privateKeyPem: evilKeyPair.privateKey, publicKeyBase64: evilKeyPair.publicKey });
    void fixture;

    const r = runCli(["approve", "scripts/agent-tools/foo.sh"], {
      proj,
      env: { TOOLSMITH_ATTEST_IT_POLL_MS: "10", TOOLSMITH_ATTEST_IT_POLL_ATTEMPTS: "1" },
    });
    expect(r.status).toBe(1);
    expect(existsSync(join(proj, "scripts", "agent-tools", "foo.sh"))).toBe(false);
  });
});
