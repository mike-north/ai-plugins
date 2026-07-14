/**
 * Tests for the gh.mjs wrapper: PR-ref/host resolution (network-free), and the
 * api/graphql/currentLogin helpers exercised against a stub `gh` executable
 * (no network, no real GitHub auth) pointed to via `$GH`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { api, currentLogin, ghBin, graphql, parsePrUrl, resolveHost, resolvePrRef } from "./gh.mjs";

describe("parsePrUrl", () => {
  it("parses a github.com PR URL", () => {
    expect(parsePrUrl("https://github.com/acme/widgets/pull/42")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "widgets",
      number: 42,
    });
  });

  it("parses a GitHub Enterprise PR URL with a trailing path", () => {
    expect(parsePrUrl("https://ghe.example.com/acme/widgets/pull/42/files")).toEqual({
      host: "ghe.example.com",
      owner: "acme",
      repo: "widgets",
      number: 42,
    });
  });

  it("strips a :port from the captured host, since gh's --hostname does not accept one (finding G regression)", () => {
    expect(parsePrUrl("https://ghe.example.com:8443/acme/widgets/pull/42")).toEqual({
      host: "ghe.example.com",
      owner: "acme",
      repo: "widgets",
      number: 42,
    });
  });

  it("returns null for a non-PR URL (negative)", () => {
    expect(parsePrUrl("https://github.com/acme/widgets/issues/42")).toBeNull();
  });

  it("returns null for a non-URL string (negative)", () => {
    expect(parsePrUrl("42")).toBeNull();
    expect(parsePrUrl(undefined)).toBeNull();
  });
});

describe("resolveHost", () => {
  it("prefers an explicit host argument over everything else", () => {
    expect(
      resolveHost({ hostArg: "explicit.example.com", prUrl: "https://github.com/a/b/pull/1", ghHostEnv: "env.example.com" }),
    ).toBe("explicit.example.com");
  });

  it("falls back to the PR URL's host", () => {
    expect(resolveHost({ prUrl: "https://ghe.example.com/a/b/pull/1", ghHostEnv: "env.example.com" })).toBe(
      "ghe.example.com",
    );
  });

  it("falls back to $GH_HOST when there is no explicit host or URL", () => {
    expect(resolveHost({ ghHostEnv: "env.example.com" })).toBe("env.example.com");
  });

  it("defaults to github.com (negative: nothing else supplied)", () => {
    expect(resolveHost({})).toBe("github.com");
  });
});

describe("resolvePrRef", () => {
  it("resolves from a PR URL", () => {
    expect(resolvePrRef({ prUrl: "https://github.com/acme/widgets/pull/42" })).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "widgets",
      number: 42,
    });
  });

  it("an explicit host argument overrides the URL's own host", () => {
    expect(resolvePrRef({ prUrl: "https://github.com/acme/widgets/pull/42", hostArg: "ghe.example.com" }).host).toBe(
      "ghe.example.com",
    );
  });

  it("resolves from --repo/--pr, defaulting host to $GH_HOST then github.com", () => {
    expect(resolvePrRef({ repo: "acme/widgets", pr: 42 })).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "widgets",
      number: 42,
    });
    expect(resolvePrRef({ repo: "acme/widgets", pr: 42, ghHostEnv: "ghe.example.com" }).host).toBe(
      "ghe.example.com",
    );
  });

  it("rejects a malformed --repo value (negative)", () => {
    expect(() => resolvePrRef({ repo: "not-owner-slash-repo", pr: 1 })).toThrow(/owner\/repo/);
  });

  it("rejects when neither a PR URL nor --repo/--pr is given (negative)", () => {
    expect(() => resolvePrRef({})).toThrow(/either --pr-url or --repo\/--pr/);
  });

  it("rejects an unparseable PR URL (negative)", () => {
    expect(() => resolvePrRef({ prUrl: "https://github.com/acme/widgets/issues/42" })).toThrow(/not a PR URL/);
  });
});

describe("ghBin", () => {
  const original = process.env.GH;
  afterEach(() => {
    if (original === undefined) delete process.env.GH;
    else process.env.GH = original;
  });

  it("defaults to 'gh'", () => {
    delete process.env.GH;
    expect(ghBin()).toBe("gh");
  });

  it("honors $GH", () => {
    process.env.GH = "/custom/gh";
    expect(ghBin()).toBe("/custom/gh");
  });
});

// ---------------------------------------------------------------------------
// api / graphql / currentLogin, against a stub `gh` executable.
//
// The stub is a tiny Node script driven by a JSON "script" file (path in
// $STUB_SCRIPT): an ordered list of `{ when: RegExp-source-string-or-null,
// status, stdout, stderr }` rules. Each invocation of the stub scans argv,
// takes the first still-unconsumed rule whose `when` matches (or has no
// `when`), marks it consumed so a repeated call advances to the next matching
// rule, and exits with `status` after printing `stdout`/`stderr`.
// ---------------------------------------------------------------------------

let dir;
let originalGh;

function writeStub() {
  const stubPath = path.join(dir, "stub-gh.mjs");
  fs.writeFileSync(
    stubPath,
    `#!/usr/bin/env node
import * as fs from "node:fs";
const scriptPath = process.env.STUB_SCRIPT;
const argvText = process.argv.slice(2).join(" ");
const rules = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
const idx = rules.findIndex((r) => !r.consumed && (r.when == null || new RegExp(r.when).test(argvText)));
if (idx === -1) {
  process.stderr.write("stub-gh: no matching rule for: " + argvText + "\\n");
  process.exit(1);
}
const rule = rules[idx];
rule.consumed = true;
fs.writeFileSync(scriptPath, JSON.stringify(rules));
if (rule.stdout) process.stdout.write(rule.stdout);
if (rule.stderr) process.stderr.write(rule.stderr);
process.exit(rule.status ?? 0);
`,
  );
  fs.chmodSync(stubPath, 0o755);
  return stubPath;
}

function setScript(rules) {
  const scriptPath = path.join(dir, "stub-script.json");
  fs.writeFileSync(scriptPath, JSON.stringify(rules));
  process.env.STUB_SCRIPT = scriptPath;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-mjs-test-"));
  originalGh = process.env.GH;
  process.env.GH = writeStub();
});

afterEach(() => {
  if (originalGh === undefined) delete process.env.GH;
  else process.env.GH = originalGh;
  delete process.env.STUB_SCRIPT;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("api", () => {
  it("parses a plain JSON GET response", () => {
    setScript([{ when: "^api --hostname github\\.com repos/o/r/pulls/1$", status: 0, stdout: '{"number":1}\n' }]);
    expect(api("github.com", "repos/o/r/pulls/1")).toEqual({ number: 1 });
  });

  it("sends a JSON body via --input - and defaults to POST when a body is given", () => {
    setScript([{ when: "-X POST .*--input -", status: 0, stdout: '{"ok":true}\n' }]);
    expect(api("github.com", "repos/o/r/issues/1/comments", { body: { body: "hi" } })).toEqual({ ok: true });
  });

  it("flattens --paginate --slurp pages into one array", () => {
    setScript([{ when: "--paginate --slurp", status: 0, stdout: "[[1,2],[3]]\n" }]);
    expect(api("github.com", "repos/o/r/pulls/1/files", { paginate: true })).toEqual([1, 2, 3]);
  });

  it("returns raw text (not JSON-parsed) when --jq is used", () => {
    setScript([{ when: "--jq \\.login", status: 0, stdout: "octocat\n" }]);
    expect(api("github.com", "user", { jq: ".login" })).toBe("octocat");
  });

  it("throws a descriptive error on non-zero exit (negative)", () => {
    setScript([{ status: 1, stderr: "HTTP 404: Not Found\n" }]);
    expect(() => api("github.com", "repos/o/r/pulls/999")).toThrow(/HTTP 404/);
  });

  it("throws a descriptive error naming the command and the response, on invalid JSON (finding F regression)", () => {
    const junk = `not json at all ${"x".repeat(300)}`;
    setScript([{ status: 0, stdout: `${junk}\n` }]);
    let caught;
    try {
      api("github.com", "repos/o/r/pulls/1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toContain("repos/o/r/pulls/1"); // names the command/path
    expect(caught.message).toContain(junk.slice(0, 200)); // includes the first ~200 chars of stdout
    expect(caught.message.length).toBeLessThan(junk.length + 200); // did not dump the whole (300+ char) response
  });
});

describe("graphql", () => {
  it("sends {query, variables} as a single JSON document on stdin to the graphql endpoint", () => {
    setScript([{ when: "graphql -X POST --input -", status: 0, stdout: '{"data":{"ok":true}}\n' }]);
    expect(graphql("github.com", "query { viewer { login } }", { x: 1 })).toEqual({ data: { ok: true } });
  });

  it("throws with the GraphQL errors' messages, carrying .errors and .data (negative)", () => {
    setScript([
      {
        status: 1,
        stdout: '{"data":null,"errors":[{"message":"Could not resolve to a PullRequestReview"}]}\n',
      },
    ]);
    let caught;
    try {
      graphql("github.com", "mutation { x }", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/Could not resolve to a PullRequestReview/);
    expect(caught.errors).toEqual([{ message: "Could not resolve to a PullRequestReview" }]);
  });

  it("rethrows the original error when the failing response body isn't parseable JSON (negative)", () => {
    setScript([{ status: 1, stdout: "not json", stderr: "boom\n" }]);
    expect(() => graphql("github.com", "query { x }", {})).toThrow(/boom/);
  });
});

describe("currentLogin", () => {
  it("returns the trimmed login", () => {
    setScript([{ when: "api --hostname github\\.com user --jq \\.login", status: 0, stdout: "octocat\n" }]);
    expect(currentLogin("github.com")).toBe("octocat");
  });
});
