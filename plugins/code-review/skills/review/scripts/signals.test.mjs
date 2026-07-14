/**
 * Tests for signals.mjs — deterministic fact-collection against a fixture repo.
 *
 * Every fixture is a real git repository so signals are exercised against
 * git's actual output, not hand-crafted diff text.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { git, makeFixtureRepo, removeDir, writeFiles } from "./test-support/git-fixture.mjs";
import { collectSignals } from "./signals.mjs";

let repo;

afterEach(() => {
  if (repo) removeDir(repo);
  repo = undefined;
});

describe("collectSignals — changed files", () => {
  it("reports uncommitted new/modified files with extensions and top-level dirs", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    writeFiles(repo, { "src/index.ts": "export const x = 1;\n", "src/util/format.ts": "export {};\n" });
    const signals = collectSignals({ root: repo });

    expect(signals.changed.files).toEqual(["src/index.ts", "src/util/format.ts"]);
    expect(signals.changed.by_ext).toMatchObject({ ts: 2 });
    expect(signals.changed.dirs).toEqual(["src"]);
  });

  it("counts new files and renames separately from plain modifications", () => {
    repo = makeFixtureRepo({ "a.txt": "one\n" });
    git(["mv", "a.txt", "b.txt"], repo);
    writeFiles(repo, { "c.txt": "new file\n" });
    git(["add", "-A"], repo);
    const signals = collectSignals({ root: repo });

    expect(signals.diff.new_files).toBe(1); // c.txt
    expect(signals.diff.renames).toBe(1); // a.txt -> b.txt
  });

  it("does not corrupt an unstaged-delete file path (regression: leading-space porcelain line)", () => {
    // Bug: `git status --porcelain` prefixes an unstaged (not-yet-`git add`ed)
    // delete with a leading space (" D path"). The shared git() helper used
    // to `.trim()` the whole multi-line stdout, which stripped that leading
    // space off the *first* line only, shifting the 2-char-status/3-char-path
    // slice by one column and cutting the first character off that one path.
    repo = makeFixtureRepo({ "alpha.txt": "one\n" });
    fs.unlinkSync(path.join(repo, "alpha.txt")); // unstaged delete: " D alpha.txt"
    const signals = collectSignals({ root: repo });

    expect(signals.changed.files).toEqual(["alpha.txt"]);
  });

  it("resolves an explicit --base against committed history", () => {
    repo = makeFixtureRepo({ "a.txt": "one\n" });
    const base = git(["rev-parse", "HEAD"], repo).trim();
    writeFiles(repo, { "a.txt": "one\ntwo\n" });
    git(["add", "-A"], repo);
    git(["commit", "-q", "-m", "second"], repo);

    const signals = collectSignals({ root: repo, base });
    expect(signals.changed.files).toEqual(["a.txt"]);
    expect(signals.diff.lines).toBeGreaterThan(0);
  });
});

describe("collectSignals — diff shape flags", () => {
  it("marks a docs-only change as docs_only with no source_touched", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    writeFiles(repo, { "README.md": "# hi\n\nmore docs\n", "docs/guide.md": "guide\n" });
    const signals = collectSignals({ root: repo });

    expect(signals.diff.docs_only).toBe(true);
    expect(signals.diff.source_touched).toBe(false);
    expect(signals.diff.tests_touched).toBe(false);
  });

  it("marks source_touched when a non-test, non-doc file changes", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    writeFiles(repo, { "src/index.ts": "export const x = 1;\n" });
    const signals = collectSignals({ root: repo });

    expect(signals.diff.source_touched).toBe(true);
    expect(signals.diff.docs_only).toBe(false);
  });

  it("marks tests_touched when a *.test.* file changes", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    writeFiles(repo, { "src/index.test.ts": "test('x', () => {});\n" });
    const signals = collectSignals({ root: repo });

    expect(signals.diff.tests_touched).toBe(true);
  });

  it("marks api_surface when a .proto file changes", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    writeFiles(repo, { "service.proto": "syntax = \"proto3\";\n" });
    const signals = collectSignals({ root: repo });

    expect(signals.diff.api_surface).toBe(true);
  });

  it("reports docs_only false and empty flags when there is no change at all", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    const signals = collectSignals({ root: repo });

    expect(signals.changed.files).toEqual([]);
    expect(signals.diff.docs_only).toBe(false);
    expect(signals.diff.source_touched).toBe(false);
  });
});

describe("collectSignals — manifests", () => {
  it("detects manifests present at the repo root, including glob patterns", () => {
    repo = makeFixtureRepo({
      "package.json": "{}\n",
      "tsconfig.build.json": "{}\n",
      "nx.json": "{}\n",
      "pnpm-workspace.yaml": "packages: []\n",
    });
    writeFiles(repo, { ".changeset/foo.md": "---\n---\n" });
    const signals = collectSignals({ root: repo });

    expect(signals.manifests).toEqual(
      expect.arrayContaining(["package.json", "tsconfig.build.json", "nx.json", "pnpm-workspace.yaml", ".changeset"]),
    );
  });

  it("does not report manifests that are absent", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    const signals = collectSignals({ root: repo });
    expect(signals.manifests).toEqual([]);
  });
});

describe("collectSignals — deps", () => {
  it("detects spf13/cobra from go.sum", () => {
    repo = makeFixtureRepo({ "go.sum": "github.com/spf13/cobra v1.8.0 h1:abc=\n" });
    const signals = collectSignals({ root: repo });
    expect(signals.deps).toContain("spf13/cobra");
  });

  it("detects yargs and commander from package.json but not unrelated deps", () => {
    repo = makeFixtureRepo({
      "package.json": JSON.stringify({ dependencies: { yargs: "^17.0.0", commander: "^12.0.0", lodash: "^4.0.0" } }),
    });
    const signals = collectSignals({ root: repo });
    expect(signals.deps).toEqual(expect.arrayContaining(["yargs", "commander"]));
    expect(signals.deps).not.toContain("lodash");
  });

  it("detects clap from Cargo.toml and sorbet from Gemfile", () => {
    repo = makeFixtureRepo({
      "Cargo.toml": '[dependencies]\nclap = "4"\n',
      "Gemfile": 'gem "sorbet"\n',
    });
    const signals = collectSignals({ root: repo });
    expect(signals.deps).toEqual(expect.arrayContaining(["clap", "sorbet"]));
  });

  it("reports no deps when no manifest matches any check", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    const signals = collectSignals({ root: repo });
    expect(signals.deps).toEqual([]);
  });
});

describe("collectSignals — bins and remote_host", () => {
  it("detects package.json#bin presence", () => {
    repo = makeFixtureRepo({ "package.json": JSON.stringify({ bin: "./cli.js" }) });
    const signals = collectSignals({ root: repo });
    expect(signals.bins).toBe(true);
  });

  it("reports bins false when package.json has no bin field", () => {
    repo = makeFixtureRepo({ "package.json": JSON.stringify({ name: "x" }) });
    const signals = collectSignals({ root: repo });
    expect(signals.bins).toBe(false);
  });

  it("reports bins false when package.json is invalid JSON", () => {
    repo = makeFixtureRepo({ "package.json": "{ not json" });
    const signals = collectSignals({ root: repo });
    expect(signals.bins).toBe(false);
  });

  it("extracts the hostname from an https origin remote", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    git(["remote", "add", "origin", "https://github.com/acme/widget.git"], repo);
    const signals = collectSignals({ root: repo });
    expect(signals.remote_host).toBe("github.com");
  });

  it("extracts the hostname from an scp-like ssh origin remote", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    git(["remote", "add", "origin", "git@git.corp.example.com:acme/widget.git"], repo);
    const signals = collectSignals({ root: repo });
    expect(signals.remote_host).toBe("git.corp.example.com");
  });

  it("reports remote_host null when there is no origin remote", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    const signals = collectSignals({ root: repo });
    expect(signals.remote_host).toBeNull();
  });
});

describe("collectSignals — tools", () => {
  it("detects eslint and vitest config presence", () => {
    repo = makeFixtureRepo({
      "eslint.config.js": "export default [];\n",
      "vitest.config.ts": "export default {};\n",
    });
    const signals = collectSignals({ root: repo });
    expect(signals.tools.linter).toBe("eslint");
    expect(signals.tools.test_framework).toBe("vitest");
  });

  it("reports null tool facts when no config files are present", () => {
    repo = makeFixtureRepo({ "README.md": "# hi\n" });
    const signals = collectSignals({ root: repo });
    expect(signals.tools).toEqual({ linter: null, formatter: null, test_framework: null });
  });
});
