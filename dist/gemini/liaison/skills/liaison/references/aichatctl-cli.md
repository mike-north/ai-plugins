# aichatctl CLI reference

`aichatctl` deterministically drives the user's **real, signed-in Chrome** to do
things these products expose no public API for. You decide *what*; the CLI does the
*doing*. Project: <https://github.com/mike-north/aichatctl>.

## The contract: you reason, the CLI executes

**Never drive the browser yourself** — no screenshot-and-click loops, no guessing at
selectors. All browser mechanics are deterministic and belong to the CLI. Your job is
the reasoning: which sources to use, what prompt to seed, which files to sync. Always
pass `--json` and parse the structured result.

## Invocation

Run via `npx aichatctl <command> …` (no install needed) or a global
`npm i -g aichatctl`. Every command accepts `--json` for machine-readable output.

## Transports

Two transports drive the user's logged-in Chrome:

- **`--transport applescript`** (primary, macOS). Drives Chrome with no extension via
  `osascript`. Requires one Chrome toggle: **View → Developer → Allow JavaScript from
  Apple Events**. **NotebookLM works only on this transport.**
- **`--transport cdp`** (fallback, default). A dedicated Playwright automation profile
  (`aichatctl browser launch`, then sign in once). For non-macOS or headless use.

## Preflight with `doctor`

Always preflight before the first real action in a session:

```bash
npx aichatctl doctor --transport applescript --json
```

It reports whether the Apple Events toggle is on and whether each platform is logged
in. If it reports a problem, tell the user exactly what to fix (enable the toggle, or
sign in to the platform), then retry. Do not proceed against a platform `doctor` says
is not ready.

## Calibration errors

When a web UI drifts and a control can't be found, commands fail with a clear
`(calibration)` error naming what wasn't found. Surface that message to the user
verbatim — it is a one-line fix upstream, not something to work around.

## Security & scope

`aichatctl` operates the user's **own** authenticated accounts at human pace. It
stores no passwords (the Chrome session holds the cookies) and persists no auth
tokens. Automating a web UI may run against a service's terms — a documented,
deliberate trade-off.
