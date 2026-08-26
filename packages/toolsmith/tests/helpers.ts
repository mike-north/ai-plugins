/**
 * Shared fixtures for the toolsmith CLI test suites: isolated temp project
 * roots and HOME dirs, registry writers mirroring
 * plugins/toolsmith/scripts/test-approve.sh's fixtures, and a runner that
 * spawns the real committed CLI bundle (plugins/toolsmith/scripts/toolsmith.mjs)
 * exactly as a human or hook would. dist-sync.test.ts guarantees the bundle
 * matches src/toolsmith-cli/ — so exercising the artifact IS exercising the
 * source.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeFingerprintSync, createSeal, generateEd25519KeyPair, writeSealsSync } from "attest-it";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const CLI = join(REPO_ROOT, "plugins", "toolsmith", "scripts", "toolsmith.mjs");
export const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "toolsmith");
/** The npm-package build (packages/toolsmith/dist/), which — unlike the
 * committed, dependency-free plugin copy at `CLI` above — sits under a real
 * node_modules and so CAN resolve `attest-it`'s dynamically-imported
 * programmatic API. Only `approve --setup` needs this distinction (see
 * scripts/build.mjs's `external` comment and commands/approve-setup.ts); the
 * SEAL/VERIFY hot path in commands/attestation.ts is CLI-only and works
 * identically from either build. */
export const DIST_CLI = join(REPO_ROOT, "packages", "toolsmith", "dist", "toolsmith.mjs");

/** Deterministic timestamp used across fixtures (never `new Date()`). */
export const SINCE = "2024-01-15T10:30:00.000Z";

const cleanupDirs: string[] = [];

/** mktemp -d equivalent, tracked for cleanup. */
export function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

/** Remove all tracked temp dirs, clearing the BSD immutable flag first so
 * uchg'd live files (a successful promotion sets it) don't survive rmSync. */
export function cleanupTmpDirs(): void {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (!dir) continue;
    try {
      spawnSync("chflags", ["-R", "nouchg", dir], { stdio: "ignore" });
    } catch {
      // chflags absent (non-macOS) — nothing to clear
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A fresh project fixture with the staging + live directories in place. */
export function newProj(): string {
  const proj = makeTmpDir("toolsmith-proj-");
  mkdirSync(join(proj, ".claude", "toolsmith", "staging"), { recursive: true });
  mkdirSync(join(proj, "scripts", "agent-tools"), { recursive: true });
  return proj;
}

/** A fresh isolated HOME with the user-scope toolsmith namespace in place. */
export function newHome(): string {
  const home = makeTmpDir("toolsmith-home-");
  mkdirSync(join(home, ".claude", "toolsmith", "staging"), { recursive: true });
  mkdirSync(join(home, ".claude", "toolsmith", "tools"), { recursive: true });
  return home;
}

export function writeStaged(proj: string, name: string, content: string): void {
  writeFileSync(join(proj, ".claude", "toolsmith", "staging", name), content);
}

export function writeUserStaged(home: string, name: string, content: string): void {
  writeFileSync(join(home, ".claude", "toolsmith", "staging", name), content);
}

export interface RegistryToolInit {
  name: string;
  path: string;
  status: string;
  approvedSha256?: string;
  permissionRule?: string;
  staged?: { path: string; sha256?: string; note?: string; since?: string } | undefined;
  covers?: string[];
  purpose?: string;
  args?: string;
  scope?: string;
}

export function registryJson(tools: RegistryToolInit[]): string {
  return (
    JSON.stringify(
      {
        version: 1,
        tools: tools.map((t) => ({
          name: t.name,
          path: t.path,
          purpose: t.purpose ?? "Do a narrow thing",
          args: t.args ?? "<foo>",
          scope: t.scope ?? "repo (read-only)",
          covers: t.covers ?? ["some\\s+pattern"],
          status: t.status,
          approvedSha256: t.approvedSha256 ?? "",
          permissionRule: t.permissionRule ?? "",
          ...(t.staged ? { staged: t.staged } : {}),
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

export function writeProjectRegistry(proj: string, tools: RegistryToolInit[]): void {
  writeFileSync(join(proj, ".claude", "toolsmith", "registry.json"), registryJson(tools));
}

export function writeUserRegistry(home: string, tools: RegistryToolInit[]): void {
  writeFileSync(join(home, ".claude", "toolsmith", "registry.json"), registryJson(tools));
}

/** A brand-new project tool: draft status, only "staged" populated. */
export function newDraftTool(name: string, note = "initial draft"): RegistryToolInit {
  return {
    name,
    path: `scripts/agent-tools/${name}`,
    status: "draft",
    staged: { path: `.claude/toolsmith/staging/${name}`, sha256: "advisory-only-not-trusted", note, since: SINCE },
  };
}

/** A revision: approved + live with the given pin, plus a pending staged draft. */
export function revisionTool(name: string, liveSha: string): RegistryToolInit {
  return {
    name,
    path: `scripts/agent-tools/${name}`,
    status: "approved",
    approvedSha256: liveSha,
    permissionRule: `Bash(scripts/agent-tools/${name}:*)`,
    staged: {
      path: `.claude/toolsmith/staging/${name}`,
      sha256: "advisory-only-not-trusted",
      note: "proposed revision",
      since: SINCE,
    },
  };
}

export function sha256Hex(content: string | Buffer): string {
  const out = execFileSync("shasum", ["-a", "256"], { input: content });
  return out.toString().split(" ")[0]!;
}

/** Write an executable live script and return its sha256. */
export function writeLive(proj: string, name: string, content: string): string {
  const p = join(proj, "scripts", "agent-tools", name);
  writeFileSync(p, content);
  chmodSync(p, 0o755);
  return sha256Hex(content);
}

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface RunCliOptions {
  proj?: string;
  home?: string;
  env?: Record<string, string>;
}

/** Spawn the committed CLI bundle with an isolated project root and HOME. */
/** `attest-it` is a dependency of packages/toolsmith, not of the repo root,
 * so its binary only lands in packages/toolsmith/node_modules/.bin — which
 * is NOT on PATH when vitest's `--root ../..` puts the spawning process's
 * cwd at the repo root. Prepend it explicitly so the admission gate's
 * `spawnSync("attest-it", ...)` resolves in tests exactly as it would for a
 * human who ran `pnpm install` in packages/toolsmith. */
const TOOLSMITH_BIN_DIR = join(REPO_ROOT, "packages", "toolsmith", "node_modules", ".bin");

export function runCli(args: string[], opts: RunCliOptions = {}): CliResult {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${TOOLSMITH_BIN_DIR}:${process.env["PATH"] ?? ""}`,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    ...(opts.proj ? { CLAUDE_PROJECT_DIR: opts.proj } : {}),
    ...(opts.home ? { HOME: opts.home } : {}),
    ...opts.env,
  };
  // Never let ambient fault-injection leak between tests.
  if (!opts.env?.["TOOLSMITH_APPROVE_KILL_AFTER"]) delete env["TOOLSMITH_APPROVE_KILL_AFTER"];
  if (!opts.env?.["TOOLSMITH_APPROVE_CORRUPT_REGISTRY_STEP6"]) delete env["TOOLSMITH_APPROVE_CORRUPT_REGISTRY_STEP6"];
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/** Same as `runCli`, but against the npm-package build (`DIST_CLI`) instead
 * of the committed plugin copy — see `DIST_CLI`'s doc comment. */
export function runDistCli(args: string[], opts: RunCliOptions = {}): CliResult {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${TOOLSMITH_BIN_DIR}:${process.env["PATH"] ?? ""}`,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    ...(opts.proj ? { CLAUDE_PROJECT_DIR: opts.proj } : {}),
    ...(opts.home ? { HOME: opts.home } : {}),
    ...opts.env,
  };
  const r = spawnSync(process.execPath, [DIST_CLI, ...args], { env, encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/** Octal mode string of a file, e.g. "555". */
export function fileMode(path: string): string {
  const r = spawnSync("stat", ["-f", "%Lp", path], { encoding: "utf8" });
  if (r.status === 0) return r.stdout.trim();
  const gnu = spawnSync("stat", ["-c", "%a", path], { encoding: "utf8" });
  return gnu.stdout.trim();
}

export function chflagsAvailableInTests(): boolean {
  try {
    return spawnSync("which", ["chflags"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export function attestItAvailableInTests(): boolean {
  try {
    return (
      spawnSync("attest-it", ["--version"], {
        stdio: "ignore",
        env: { ...process.env, PATH: `${TOOLSMITH_BIN_DIR}:${process.env["PATH"] ?? ""}` },
      }).status === 0
    );
  } catch {
    return false;
  }
}

/** Init a real git repo at `proj` and commit everything currently on disk —
 * attest-it's admission gate requires a clean, committed tree (AC5), so
 * admission fixtures need real git plumbing, unlike the rest of this suite's
 * bare tmp dirs. */
export function gitCommitAll(proj: string, message = "init"): void {
  spawnSync("git", ["init", "-q"], { cwd: proj });
  spawnSync("git", ["config", "user.email", "toolsmith-tests@example.com"], { cwd: proj });
  spawnSync("git", ["config", "user.name", "toolsmith-tests"], { cwd: proj });
  spawnSync("git", ["add", "-A"], { cwd: proj });
  spawnSync("git", ["commit", "-q", "-m", message], { cwd: proj });
}

export function gitDirty(proj: string, relPath: string, content: string): void {
  writeFileSync(join(proj, relPath), content);
}

/** A fresh Ed25519 identity + the `.attest-it/config.yaml` +
 * `.attest-it/toolsmith-admission-signer.json` this suite's `approve
 * --setup` would produce for it, written directly (setup itself is exercised
 * separately) so admission tests can focus on the SEAL/VERIFY gate. */
export interface AdmissionFixture {
  slug: string;
  privateKeyPem: string;
  publicKeyBase64: string;
}

export function writeAdmissionFixture(proj: string, slug = "testhuman"): AdmissionFixture {
  const kp = generateEd25519KeyPair();
  const configYaml = `version: 1
settings:
  maxAgeDays: 365
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json
  sealsPath: .attest-it/seals.yaml
team:
  ${slug}:
    name: ${slug}
    publicKey: ${kp.publicKey}
    publicKeyAlgorithm: ed25519
gates:
  toolsmith-admission:
    name: Toolsmith admission
    description: test fixture
    authorizedSigners:
      - ${slug}
    fingerprint:
      paths:
        - .claude/toolsmith
      exclude:
        - "**/history.jsonl"
        - "**/*.local.*"
    maxAge: 365d
suites:
  toolsmith-admission:
    gate: toolsmith-admission
    description: test fixture
    command: "true"
`;
  mkdirSync(join(proj, ".attest-it"), { recursive: true });
  writeFileSync(join(proj, ".attest-it", "config.yaml"), configYaml);
  writeFileSync(
    join(proj, ".attest-it", "toolsmith-admission-signer.json"),
    JSON.stringify({ slug, publicKey: kp.publicKey, pinnedAt: SINCE }, null, 2) + "\n",
  );
  return { slug, privateKeyPem: kp.privateKey, publicKeyBase64: kp.publicKey };
}

/** Compute the CURRENT admission fingerprint for `proj` and write a valid
 * seal for it, signed by `fixture`'s key — simulating a human having just
 * run `attest-it run --suite toolsmith-admission` in their own terminal. */
export function sealAdmission(proj: string, fixture: AdmissionFixture): string {
  const fp = computeFingerprintSync({
    packages: [".claude/toolsmith"],
    baseDir: proj,
    ignore: ["**/history.jsonl", "**/*.local.*"],
  });
  const seal = createSeal({
    gateId: "toolsmith-admission",
    fingerprint: fp.fingerprint,
    sealedBy: fixture.slug,
    privateKey: fixture.privateKeyPem,
  });
  writeSealsSync(proj, { version: 1, seals: { "toolsmith-admission": seal } });
  return fp.fingerprint;
}
