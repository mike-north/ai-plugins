// Minimal `gh` CLI wrapper: hostname resolution, REST/GraphQL request helpers,
// and current-user lookup. Zero dependencies — shells out to `${GH:-gh}` via
// execFileSync only; every other module in this plugin builds on these three
// primitives (`api`, `graphql`, `currentLogin`) rather than invoking `gh` itself.
//
// GraphQL bodies are always sent as a single JSON document on stdin
// (`gh api --hostname <host> graphql --input -`) — dynamic content (PR body
// text, suggestion fences, etc.) goes ONLY into `variables`, never spliced
// into the query string, so it can never break GraphQL parsing or enable
// query injection.
//
// @see https://cli.github.com/manual/gh_api
// @see https://docs.github.com/en/graphql

import { execFileSync } from "node:child_process";
import { CliError, EXIT } from "./cli.mjs";

const PR_URL_RE = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?].*)?$/;

/** The `gh` binary to invoke — `$GH` if set, otherwise `gh` on PATH. */
export function ghBin() {
  return process.env.GH || "gh";
}

/**
 * Parse a PR URL (any host, e.g. GitHub Enterprise) into its parts.
 * @returns {{host: string, owner: string, repo: string, number: number} | null}
 */
export function parsePrUrl(url) {
  const m = typeof url === "string" ? PR_URL_RE.exec(url) : null;
  if (!m) return null;
  // `gh api --hostname` takes a bare hostname — strip a captured ":port"
  // (e.g. an on-prem GHE mirror on a non-default port) before returning it.
  const host = m[1].replace(/:\d+$/, "");
  return { host, owner: m[2], repo: m[3], number: Number(m[4]) };
}

/**
 * Resolve the GitHub hostname to target: explicit arg → parsed from a PR URL
 * → `$GH_HOST` → `github.com`.
 */
export function resolveHost({ hostArg, prUrl, ghHostEnv } = {}) {
  if (hostArg) return hostArg;
  const parsed = prUrl ? parsePrUrl(prUrl) : null;
  if (parsed) return parsed.host;
  if (ghHostEnv) return ghHostEnv;
  return "github.com";
}

/**
 * Resolve a full PR reference (host, owner, repo, number) from either a PR
 * URL or an explicit `--repo owner/repo --pr N`. An explicit `hostArg`
 * always wins (even over a URL's own host — e.g. an on-prem mirror).
 */
export function resolvePrRef({ prUrl, repo, pr, hostArg, ghHostEnv } = {}) {
  if (prUrl) {
    const parsed = parsePrUrl(prUrl);
    if (!parsed) throw new Error(`not a PR URL: ${prUrl}`);
    return { host: hostArg ?? parsed.host, owner: parsed.owner, repo: parsed.repo, number: parsed.number };
  }
  if (repo && pr != null) {
    const m = /^([^/]+)\/([^/]+)$/.exec(repo);
    if (!m) throw new Error(`--repo must be in "owner/repo" form (got "${repo}")`);
    return { host: hostArg ?? ghHostEnv ?? "github.com", owner: m[1], repo: m[2], number: Number(pr) };
  }
  throw new Error("either --pr-url or --repo/--pr is required");
}

/** Run `gh` with `args`, returning stdout. Throws with stdout/stderr attached on failure. */
function runGh(args, { input } = {}) {
  try {
    return execFileSync(ghBin(), args, {
      encoding: "utf8",
      input,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const err = new Error(`gh ${args.join(" ")} failed: ${(e.stderr ?? "").toString().trim() || e.message}`);
    err.ghStdout = e.stdout != null ? e.stdout.toString() : "";
    err.ghStderr = e.stderr != null ? e.stderr.toString() : "";
    err.cause = e;
    throw err;
  }
}

/**
 * `gh api --hostname <host> <path>`.
 *
 * @param {string} host
 * @param {string} apiPath          e.g. "repos/o/r/pulls/42"
 * @param {object} [opts]
 * @param {string} [opts.method]    defaults to GET, or POST when `body` is given
 * @param {boolean} [opts.paginate] follow pagination; returns a flattened array
 * @param {object} [opts.body]      JSON body, sent via `--input -`
 * @param {string} [opts.jq]        `--jq` expression; when given, returns raw text
 * @returns {any}
 */
export function api(host, apiPath, { method, paginate, body, jq } = {}) {
  const args = ["api", "--hostname", host, apiPath];
  if (jq) args.push("--jq", jq);
  const effectiveMethod = method ?? (body !== undefined ? "POST" : undefined);
  if (effectiveMethod) args.push("-X", effectiveMethod);
  if (paginate) args.push("--paginate", "--slurp");
  let input;
  if (body !== undefined) {
    args.push("--input", "-");
    input = JSON.stringify(body);
  }
  const stdout = runGh(args, { input });
  if (jq) return stdout.replace(/\n$/, "");
  const trimmed = stdout.trim();
  if (trimmed === "") return paginate ? [] : undefined;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    throw new CliError(
      `gh ${args.join(" ")} returned invalid JSON: ${e.message} (first 200 chars: ${trimmed.slice(0, 200)})`,
      EXIT.UNEXPECTED,
    );
  }
  return paginate ? (Array.isArray(parsed) ? parsed.flat() : []) : parsed;
}

/**
 * `gh api --hostname <host> graphql --input -` with `{query, variables}` on
 * stdin. Throws on transport failure AND on a GraphQL `errors` envelope
 * (gh itself exits non-zero for the latter) — in both cases the thrown Error
 * carries `.errors`/`.data` when the response body was parseable, so callers
 * implementing a partial-success fallback can inspect what *did* land.
 */
export function graphql(host, query, variables) {
  try {
    return api(host, "graphql", { method: "POST", body: { query, variables: variables ?? {} } });
  } catch (e) {
    let envelope;
    try {
      envelope = JSON.parse((e.ghStdout ?? "").trim());
    } catch {
      throw e;
    }
    const err = new Error(
      `graphql failed: ${(envelope.errors ?? []).map((x) => x.message).join("; ") || e.message}`,
    );
    err.errors = envelope.errors;
    err.data = envelope.data;
    err.cause = e;
    throw err;
  }
}

/** The authenticated user's login on `host`. */
export function currentLogin(host) {
  return api(host, "user", { jq: ".login" }).trim();
}
