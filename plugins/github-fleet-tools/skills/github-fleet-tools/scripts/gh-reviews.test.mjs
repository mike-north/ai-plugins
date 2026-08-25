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

let dir, stub, emptyStub;

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
  stub = makeStub("gh-stub", payload);

  // Same shape, but with an empty comment body — the degenerate case that a
  // naive indent step renders as a whitespace-only line.
  const emptyPayload = JSON.parse(JSON.stringify(payload));
  emptyPayload.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0].body = "";
  emptyStub = makeStub("gh-stub-empty", emptyPayload);
});

/** Write an executable `gh` stub answering the calls each subcommand makes. */
function makeStub(name, payload) {
  const p = join(dir, name);
  writeFileSync(
    p,
    [
      "#!/usr/bin/env bash",
      'if [[ "$1" == "repo" ]]; then echo "mike-north/fixture"; exit 0; fi',
      // `status` shells out to `gh pr view` for the CI/merge-state block.
      'if [[ "$1" == "pr" ]]; then echo "{}"; exit 0; fi',
      // Real `gh api --jq F` applies F to the response before printing, and
      // `status` depends on that. Emulate it so the stub exercises the same
      // filter the tool ships rather than bypassing it.
      "filter=''",
      'while [[ $# -gt 0 ]]; do',
      '  if [[ "$1" == "--jq" ]]; then filter="$2"; shift; fi',
      "  shift",
      "done",
      `payload=$(cat <<'JSON'\n${JSON.stringify(payload)}\nJSON`,
      ")",
      'if [[ -n "$filter" ]]; then printf \'%s\' "$payload" | jq -r "$filter"; else printf \'%s\\n\' "$payload"; fi',
      "",
    ].join("\n"),
  );
  chmodSync(p, 0o755);
  return p;
}

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args) => runWith(stub, ...args);

const runWith = (gh, ...args) =>
  execFileSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, GH: gh },
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

describe("gh-reviews status renders full comment bodies", () => {
  it("emits the whole body, not a 140-char prefix", () => {
    const out = run("status", "1");
    expect(out).toContain(TAIL);
  });

  it("preserves the body's own line breaks", () => {
    const out = run("status", "1");
    expect(out).toMatch(/- Backward at EOF.*\n.*next lint pass/);
  });
});

describe("gh-reviews resolve --dry-run does not cap the preview text", () => {
  it("shows the full body on the preview line", () => {
    const out = run("resolve", "1", "--dry-run");
    expect(out).toContain("[would resolve]");
    expect(out).toContain(TAIL);
  });
});

describe("gh-reviews handles an empty comment body", () => {
  // Guards the degenerate case: jq's split("\n") on "" yields [""], which a
  // naive indent step turns into a spaces-only line under the header.
  const hasBlankLine = (out) =>
    out.split("\n").some((l) => l.length > 0 && l.trim() === "");

  it("threads: emits no whitespace-only line", () => {
    expect(hasBlankLine(runWith(emptyStub, "threads", "1"))).toBe(false);
  });

  it("status: an empty body contributes no line of its own", () => {
    const out = runWith(emptyStub, "status", "1");
    // The threads block should hold exactly the bullet line plus the single
    // blank that `status` prints as a section separator before "=== END".
    // The pre-fix output added a second, body-derived blank line here.
    const block = out
      .slice(out.indexOf("--- Unresolved review threads ---"))
      .split("\n")
      .slice(1);
    const upToEnd = block.slice(0, block.findIndex((l) => l.startsWith("=== END")));
    expect(upToEnd.filter((l) => l.trim() === "")).toHaveLength(1);
    expect(upToEnd[0]).toContain("thread_comment_id=1");
  });
});
