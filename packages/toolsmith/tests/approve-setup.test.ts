/**
 * Regression tests for `toolsmith approve --setup` (docs/toolsmith/
 * attest-it-admission.md §Migration and rollout — issue #76). AC3a (#133)
 * coverage: setup refuses identities that are not presence-backed and
 * accepts ones that are, per attest-it's own PrivateKeyRef.type documentation
 * (see lib/attestation.ts's header comment for the citation).
 *
 * @see docs/toolsmith/attest-it-admission.md
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateEd25519KeyPair, saveLocalConfigSync } from "attest-it";
import { attestItAvailableInTests, cleanupTmpDirs, gitCommitAll, makeTmpDir, newProj, runCli, runDistCli } from "./helpers.js";

afterAll(cleanupTmpDirs);

const HAS_ATTEST_IT = attestItAvailableInTests();
const maybeDescribe = HAS_ATTEST_IT ? describe : describe.skip;

/** An isolated `ATTEST_IT_HOME` with a single local identity of the given
 * `privateKey.type`, so setup's presence check can be exercised without a
 * real 1Password/YubiKey/interactive `identity create`. */
function writeLocalIdentity(attestItHome: string, type: "file" | "yubikey" | "1password"): void {
  mkdirSync(attestItHome, { recursive: true });
  const kp = generateEd25519KeyPair();
  const privateKey =
    type === "file"
      ? { type: "file" as const, path: join(attestItHome, "fake.pem") }
      : type === "yubikey"
        ? { type: "yubikey" as const, encryptedKeyPath: join(attestItHome, "fake.enc"), slot: 2 as const }
        : { type: "1password" as const, vault: "fake-vault", item: "fake-item" };
  process.env["ATTEST_IT_HOME"] = attestItHome;
  saveLocalConfigSync({
    version: 1,
    activeIdentity: "testhuman",
    identities: { testhuman: { name: "testhuman", publicKey: kp.publicKey, privateKey } },
  });
  delete process.env["ATTEST_IT_HOME"];
}

maybeDescribe("toolsmith approve --setup", () => {
  it("refuses a non-presence-backed (filesystem) identity — AC3a", () => {
    const proj = newProj();
    gitCommitAll(proj);
    const home = makeTmpDir("attest-it-home-");
    writeLocalIdentity(home, "file");

    const r = runDistCli(["approve", "--setup"], { proj, env: { ATTEST_IT_HOME: home } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/does not demand a per-signature human-presence action/);
    expect(existsSync(join(proj, ".attest-it", "config.yaml"))).toBe(false);
  });

  it("accepts a presence-backed (yubikey) identity and scaffolds the gate + pin idempotently", () => {
    const proj = newProj();
    gitCommitAll(proj);
    const home = makeTmpDir("attest-it-home-");
    writeLocalIdentity(home, "yubikey");

    const first = runDistCli(["approve", "--setup"], { proj, env: { ATTEST_IT_HOME: home } });
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/Added gate "toolsmith-admission"/);
    expect(first.stdout).toMatch(/Added suite "toolsmith-admission"/);
    expect(first.stdout).toMatch(/Pinned signer "testhuman"/);
    expect(existsSync(join(proj, ".attest-it", "config.yaml"))).toBe(true);
    expect(existsSync(join(proj, ".attest-it", "toolsmith-admission-signer.json"))).toBe(true);

    const configAfterFirst = readFileSync(join(proj, ".attest-it", "config.yaml"), "utf8");

    // Idempotent: re-running with the SAME identity does nothing further.
    const second = runDistCli(["approve", "--setup"], { proj, env: { ATTEST_IT_HOME: home } });
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/nothing to do \(idempotent\)/);
    expect(readFileSync(join(proj, ".attest-it", "config.yaml"), "utf8")).toBe(configAfterFirst);
  });

  it("refuses to silently rotate the pinned signer to a different identity", () => {
    const proj = newProj();
    gitCommitAll(proj);
    const home = makeTmpDir("attest-it-home-");
    writeLocalIdentity(home, "yubikey");
    const first = runDistCli(["approve", "--setup"], { proj, env: { ATTEST_IT_HOME: home } });
    expect(first.status).toBe(0);

    // A DIFFERENT identity becomes active on this machine (different slug —
    // writeLocalIdentity always uses "testhuman", so give this one a
    // distinct name by writing the local config directly).
    const home2 = makeTmpDir("attest-it-home-");
    mkdirSync(home2, { recursive: true });
    const kp2 = generateEd25519KeyPair();
    process.env["ATTEST_IT_HOME"] = home2;
    saveLocalConfigSync({
      version: 1,
      activeIdentity: "someone-else",
      identities: {
        "someone-else": {
          name: "someone-else",
          publicKey: kp2.publicKey,
          privateKey: { type: "yubikey", encryptedKeyPath: join(home2, "fake.enc"), slot: 2 },
        },
      },
    });
    delete process.env["ATTEST_IT_HOME"];

    const r = runDistCli(["approve", "--setup"], { proj, env: { ATTEST_IT_HOME: home2 } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/already has a signer pinned/);
  });

  it("refuses with no identities configured", () => {
    const proj = newProj();
    gitCommitAll(proj);
    const home = makeTmpDir("attest-it-home-empty-");
    mkdirSync(home, { recursive: true });
    const r = runDistCli(["approve", "--setup"], { proj, env: { ATTEST_IT_HOME: home } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no attest-it identity found/);
  });

  it("degrades to a clear, actionable error from the committed plugin copy (no node_modules nearby)", () => {
    // The marketplace-shipped copy (scripts/build.mjs's `external` comment)
    // cannot resolve attest-it's programmatic API at all — this is expected
    // and must fail closed with guidance, never a stack trace or a silent
    // no-op.
    const proj = newProj();
    gitCommitAll(proj);
    const r = runCli(["approve", "--setup"], { proj });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/could not load the `attest-it` library/);
    expect(existsSync(join(proj, ".attest-it", "config.yaml"))).toBe(false);
  });
});
