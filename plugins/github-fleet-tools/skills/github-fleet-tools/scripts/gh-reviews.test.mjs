/**
 * Regression tests for `gh-reviews` comment-body rendering.
 *
 * Bug: `threads`, `threads --json`, and `status` truncated each review comment to a
 * fixed prefix (80/100/140 chars) and collapsed every newline to a space. Long review
 * feedback was silently cut mid-sentence and embedded code examples were mangled, so a
 * reader acting on the output was working from incomplete instructions.
 *
 * These tests drive the real script with a stubbed `gh` binary via the documented `GH`
 * env override, and assert against text the fixture defines — not against whatever the
 * script currently emits.
 *
 * @see https://docs.github.com/en/graphql/reference/objects#pullrequestreviewthread
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "gh-reviews");

// A body longer than every old cap (80/100/140), with structure that collapsing
// newlines would destroy. The tail sentence only survives if nothing is truncated.
const TAIL = "This trailing sentence must survive untruncated.";
const BODY = [
  "Widening across either adjacent newline is not semantics-preserving.",
  "",
  "- Backward at EOF: `cat <<EOF` fixes to a terminator spelled `EOF `,",
  "  and the next lint pass reports an unclosed here-document.",
  "",
  TAIL,
].join("\n");

let dir, stub;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "gh-reviews-test-"));
  const payload = {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                id: "PRRT_kwtest",
                isResolved: false,
                isOutdated: false,
                path: "src/thing.ts",
                line: 124,
                comments: {
                  totalCount: 1,
                  nodes: [
                    {
                      databaseId: 12345,
                      author: { login: "reviewer" },
                      body: BODY,
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
  // Stub `gh`: `repo view` yields owner/repo, `api graphql` yields the payload.
  stub = join(dir, "gh-stub");
  writeFileSync(
    stub,
    [
      "#!/usr/bin/env bash",
      'if [[ "$1" == "repo" ]]; then echo "mike-north/fixture"; exit 0; fi',
      `cat <<'JSON'\n${JSON.stringify(payload)}\nJSON`,
      "",
    ].join("\n"),
  );
  chmodSync(stub, 0o755);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args) =>
  execFileSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, GH: stub },
  });

describe("gh-reviews renders full comment bodies", () => {
  it("threads: emits the whole body, not a truncated prefix", () => {
    const out = run("threads", "1");
    expect(out).toContain(TAIL);
    expect(out).toContain("thread_comment_id=12345");
  });

  it("threads: preserves the body's own line breaks", () => {
    const out = run("threads", "1");
    // The bullet and its continuation must stay on separate lines, not be
    // flattened into one space-joined run.
    expect(out).toMatch(/- Backward at EOF.*\n.*next lint pass/);
  });

  it("threads --json: exposes an untruncated body field", () => {
    const { threads } = JSON.parse(run("threads", "1", "--json"));
    expect(threads).toHaveLength(1);
    expect(threads[0].body).toBe(BODY);
  });

  it("threads --json: keeps snippet as a short one-line label", () => {
    const { threads } = JSON.parse(run("threads", "1", "--json"));
    // snippet stays a compact scannable label; body is the full-fidelity field.
    expect(threads[0].snippet).not.toContain("\n");
    expect(threads[0].snippet.length).toBeLessThanOrEqual(80);
  });
});
