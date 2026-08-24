#!/bin/bash
# Latency benchmark for the toolsmith PreToolUse hot path (#38). Drives the
# REAL toolsmith-gate.sh end-to-end via a piped PreToolUse JSON payload,
# following the same jq-payload idiom as smoke.sh -- not a hand-built
# approximation of the gate's logic.
#
# Measures wall-clock latency (p50/p95) for three cases:
#   not-opted-in  -- no registry anywhere; gate stat-exits, no node spawn.
#   opted-in-miss -- a registry exists, command is watched but uncovered;
#                    the node brain runs and returns no redirect.
#   opted-in-hit  -- a registry exists, command hits an approved tool's
#                    `covers`; the node brain denies/redirects.
#
# Also reports a calibrated measurement floor (two of them, layered: a bare
# fork/exec of `cat`, and a bare `/bin/bash -c` invocation) so a reader can
# see the harness's own noise is well below the differences it reports, and
# measures what prepending hooks/payload-adapter (sh+jq) would add to the
# not-opted-in path -- the number the #34 adapter-adoption decision for this
# hot path hinges on.
#
# Usage:
#   bash scripts/bench.sh [iterations]
# `iterations` defaults to 50 timed runs per case (plus a 10-run untimed
# warmup). This is an on-demand dev tool -- it is NOT wired into CI, since
# wall-clock perf numbers are machine-dependent and noisy under CI
# schedulers. Run it locally when evaluating a change to the PreToolUse
# hot path or re-litigating the #34 adapter decision for it.
set -u
# pipefail so a failure in ANY stage of a timed pipeline (payload printf,
# adapter, gate) surfaces as a nonzero status run_case can catch — without it
# a crashed earlier stage is masked by the last stage's exit 0 and the crash
# gets benchmarked as a (meaninglessly fast) sample.
set -o pipefail
cd "$(dirname "$0")" || exit 1
GATE="$PWD/toolsmith-gate.sh"
ADAPTER="$PWD/../hooks/payload-adapter"

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq not installed"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "SKIP: node not installed"; exit 0; }
# now_ns() needs python3 only on systems whose date lacks %N (historical BSD
# date) — probe once up front so that combination SKIPs cleanly like the
# guards above, instead of failing mid-run inside awk.
case "$(date +%s%N)" in
  *N) command -v python3 >/dev/null 2>&1 || { echo "SKIP: date has no %N and python3 is not installed"; exit 0; } ;;
esac

ITERATIONS="${1:-50}"
WARMUP=10

PROJ=$(mktemp -d)
USERHOME=$(mktemp -d)
SAMPLES_FILE=$(mktemp)
trap 'rm -rf "$PROJ" "$USERHOME" "$SAMPLES_FILE"' EXIT
export CLAUDE_PROJECT_DIR="$PROJ"
# Mirrors the hook test suite: the gate resolves user-scope tools via os.homedir(), which
# honors $HOME on unix -- isolate it so this never touches the real
# ~/.claude/toolsmith on the machine running the benchmark.
export HOME="$USERHOME"

# --- high-resolution wall clock --------------------------------------------
# bash 3.2 (macOS default /bin/bash) has no $EPOCHREALTIME (bash 5+ only), so
# fall back to `date +%s%N`, which gives real nanosecond precision on both
# GNU date and current macOS /bin/date. Guard against the historical BSD date
# that has no %N and prints it back literally, by falling back to python3
# (already an optional dependency elsewhere in this suite's fixture tooling).
now_ns() {
  local t
  t=$(date +%s%N)
  case "$t" in
    *N) python3 -c 'import time; print(int(time.time()*1e9))' ;;
    *) printf '%s' "$t" ;;
  esac
}

# --- fixtures ---------------------------------------------------------------
mkdir -p "$PROJ/.claude/toolsmith" "$PROJ/scripts/agent-tools"
TOOL="$PROJ/scripts/agent-tools/gh-pr-reactions"
printf '#!/bin/bash\necho reactions\n' >"$TOOL"
chmod +x "$TOOL"
SHA=$(shasum -a 256 "$TOOL" | awk '{print $1}')

write_registry() {
  cat >"$PROJ/.claude/toolsmith/registry.json" <<EOF
{
  "version": 1,
  "tools": [
    {
      "name": "gh-pr-reactions",
      "path": "scripts/agent-tools/gh-pr-reactions",
      "purpose": "Read emoji reactions on a PR's review comments",
      "args": "<pr-number>",
      "scope": "repo (read-only)",
      "covers": ["gh(_\\\\w+)?\\\\s+api\\\\b.*comments"],
      "status": "approved",
      "approvedSha256": "$SHA",
      "permissionRule": "Bash(scripts/agent-tools/gh-pr-reactions:*)"
    }
  ]
}
EOF
}
clear_registries() {
  rm -f "$PROJ/.claude/toolsmith/registry.json" "$USERHOME/.claude/toolsmith/registry.json"
}

payload() { # $1 = command
  jq -cn --arg cmd "$1" --arg cwd "$PROJ" \
    '{hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:$cmd}}'
}

# --- pipelines under test ---------------------------------------------------
noop_fork()      { cat >/dev/null; }                # bare fork/exec + pipe, no bash script
# Drains stdin with the `read` builtin (no extra fork) so this floor case
# consumes its pipe like every other pipeline under test — leaving stdin
# unread would SIGPIPE the payload printf under pipefail.
noop_bash()      { /bin/bash -c 'read -r -d "" _ || :'; } # + bash interpreter startup, no script parse
run_gate()       { "$GATE"; }
run_with_adapter() { "$ADAPTER" | "$GATE"; }

# --- timing ------------------------------------------------------------------
# Runs $WARMUP untimed passes (dyld/disk-cache warmup so the first few slow
# calls don't skew the distribution) then $ITERATIONS timed passes of
# "payload | $@", writing each elapsed wall time (ms, 3 decimals) as one line
# to $SAMPLES_FILE. The now_ns() calls that bracket each timed pass are
# themselves outside the measured interval (they run before/after, not
# during), so their own fork cost isn't charged to the interval -- only the
# real elapsed wall time between the two timestamps is.
run_case() { # $1 = command to feed as the PreToolUse payload  $2.. = pipeline
  local cmd="$1"; shift
  local p; p=$(payload "$cmd")
  local i start end status
  for ((i = 0; i < WARMUP; i++)); do
    printf '%s' "$p" | "$@" >/dev/null 2>&1 || {
      echo "ERROR: pipeline '$*' exited $? during warmup — a crashing pipeline must fail the benchmark, not get timed" >&2
      exit 1
    }
  done
  : >"$SAMPLES_FILE"
  for ((i = 0; i < ITERATIONS; i++)); do
    start=$(now_ns)
    printf '%s' "$p" | "$@" >/dev/null 2>&1
    status=$?
    end=$(now_ns)
    if [ "$status" -ne 0 ]; then
      echo "ERROR: pipeline '$*' exited $status on timed run $((i + 1)) — refusing to record samples from a failing pipeline" >&2
      exit 1
    fi
    awk -v s="$start" -v e="$end" 'BEGIN { printf "%.3f\n", (e - s) / 1000000 }' >>"$SAMPLES_FILE"
  done
}

percentile() { # $1 = p (nearest-rank, rounding up)
  sort -n "$SAMPLES_FILE" | awk -v p="$1" '
    { a[NR] = $1; n = NR }
    END {
      rank = (p / 100) * n
      idx = (rank == int(rank)) ? rank : int(rank) + 1
      if (idx < 1) idx = 1
      if (idx > n) idx = n
      printf "%.3f", a[idx]
    }'
}

# No associative arrays: macOS's default /bin/bash is 3.2, which predates
# them (bash 4.0+ only). report() stashes p50/p95 into plain globals named
# `P50_<VARNAME>` / `P95_<VARNAME>` via eval, addressable later the same way.
report() { # $1 = display label  $2 = VARNAME-safe suffix for later lookup
  local p50 p95
  p50=$(percentile 50)
  p95=$(percentile 95)
  eval "P50_$2=\"\$p50\""
  eval "P95_$2=\"\$p95\""
  printf '%-22s p50=%8s ms   p95=%8s ms   (n=%d)\n' "$1" "$p50" "$p95" "$ITERATIONS"
}

echo "toolsmith PreToolUse hot-path benchmark (#38)"
echo "iterations=$ITERATIONS warmup=$WARMUP"
echo

echo "--- calibrated measurement floor -------------------------------------"
clear_registries
run_case 'irrelevant' noop_fork
report "floor (bare fork)" FLOOR_FORK
run_case 'irrelevant' noop_bash
report "floor (bash -c)" FLOOR_BASH
echo

echo "--- real gate: three cases from issue #38 -----------------------------"
clear_registries
run_case 'gh api repos/o/r/pulls/1/comments' run_gate
report "not-opted-in" NOT_OPTED_IN

write_registry
run_case 'gh api repos/o/r/issues' run_gate
report "opted-in-miss" OPTED_IN_MISS

run_case 'gh api repos/o/r/pulls/1/comments' run_gate
report "opted-in-hit" OPTED_IN_HIT
echo

echo "--- adapter-overhead on the not-opted-in path (feeds the #34 decision) -"
clear_registries
run_case 'gh api repos/o/r/pulls/1/comments' run_with_adapter
report "not-opted-in+adapter" NOT_OPTED_IN_ADAPTER
echo

# --- summary -----------------------------------------------------------------
delta_p50=$(awk -v a="$P50_NOT_OPTED_IN_ADAPTER" -v b="$P50_NOT_OPTED_IN" 'BEGIN{printf "%.3f", a - b}')
delta_p95=$(awk -v a="$P95_NOT_OPTED_IN_ADAPTER" -v b="$P95_NOT_OPTED_IN" 'BEGIN{printf "%.3f", a - b}')
echo "--- summary -------------------------------------------------------------"
echo "adapter overhead on not-opted-in path: p50 +${delta_p50}ms   p95 +${delta_p95}ms"

# Provisional budget (#37 has not landed a canon figure yet): derive a sane
# ceiling from the measured not-opted-in p95 on THIS run, with generous
# headroom for machine variance, rather than asserting a hardcoded literal
# that would be meaningless across machines. See #38/#37 for the eventual
# canon figure this should be replaced by.
budget_ms=$(awk -v p95="$P95_NOT_OPTED_IN" 'BEGIN { b = p95 * 3; if (b < 5) b = 5; printf "%.0f", b }')
echo "provisional not-opted-in budget: <= ${budget_ms}ms p95 (3x observed p95 on this machine, floor 5ms)"
if awk -v v="$P95_NOT_OPTED_IN" -v b="$budget_ms" 'BEGIN { exit !(v <= b) }'; then
  echo "PASS: not-opted-in p95 (${P95_NOT_OPTED_IN}ms) is within the provisional budget (${budget_ms}ms)"
else
  echo "FAIL: not-opted-in p95 (${P95_NOT_OPTED_IN}ms) EXCEEDS the provisional budget (${budget_ms}ms)"
  exit 1
fi
