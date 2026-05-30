#!/usr/bin/env bash
# detect-stack.sh - Adaptive stack detection for AI code review
# Compatible with Bash 3.2+ (macOS system Bash)
set -euo pipefail

# Initialize detection arrays
DETECTED_STACKS=()
ALWAYS_ON_AGENTS=("code-quality" "tests" "simplicity")
CONDITIONAL_AGENTS=()
RESOURCES=()
LARGE_DIFF=false
STRUCTURAL_CHANGES=false
API_SURFACE_CHANGES=false
GITHUB_COM_REPO=false
HAS_CLI_FRAMEWORK=false
CLI_FRAMEWORK=""
HAS_FORMATTER=false
FORMATTER=""
HAS_LINTER=false
LINTER=""
HAS_TEST_FRAMEWORK=false
TEST_FRAMEWORK=""

# Resource map stored as parallel arrays (Bash 3 compatible)
_RMAP_AGENTS=()
_RMAP_RESOURCES=()

add_resource() {
  local agent="$1"
  local resource="$2"

  # Append to parallel arrays (duplicates resolved at output time)
  _RMAP_AGENTS+=("$agent")
  _RMAP_RESOURCES+=("$resource")

  # Add to global resources list if not already there
  if [[ ! " ${RESOURCES[*]+"${RESOURCES[*]}"} " =~ " ${resource} " ]]; then
    RESOURCES+=("$resource")
  fi
}

# Check for Go
if [[ -f "go.mod" ]]; then
  DETECTED_STACKS+=("Go")
  CONDITIONAL_AGENTS+=("go")
  HAS_FORMATTER=true
  FORMATTER="gofmt"
  HAS_TEST_FRAMEWORK=true
  TEST_FRAMEWORK="go test"

  # Check for Cobra
  if grep -q "spf13/cobra" go.sum 2>/dev/null; then
    DETECTED_STACKS+=("Cobra")
    HAS_CLI_FRAMEWORK=true
    CLI_FRAMEWORK="Cobra"
    add_resource "go" "cobra.md"
    add_resource "cli" "cobra.md"
  fi

  # Check for go-plugin
  if grep -q "hashicorp/go-plugin" go.sum 2>/dev/null; then
    DETECTED_STACKS+=("go-plugin")
    add_resource "go" "go-plugin.md"
  fi

  # Check for gRPC
  if grep -q "google.golang.org/grpc" go.sum 2>/dev/null; then
    DETECTED_STACKS+=("gRPC")
    add_resource "go" "grpc-go.md"
  fi

  # Check for golangci-lint
  if [[ -f ".golangci.yml" ]] || [[ -f ".golangci.yaml" ]]; then
    HAS_LINTER=true
    LINTER="golangci-lint"
  fi
fi

# Check for Node.js
if [[ -f "package.json" ]]; then
  DETECTED_STACKS+=("Node.js")

  # Check for Yargs
  if grep -q '"yargs"' package.json 2>/dev/null; then
    DETECTED_STACKS+=("Yargs")
    HAS_CLI_FRAMEWORK=true
    CLI_FRAMEWORK="Yargs"
    add_resource "typescript" "yargs.md"
    add_resource "cli" "yargs.md"
  fi

  # Check for Commander
  if grep -q '"commander"' package.json 2>/dev/null; then
    DETECTED_STACKS+=("Commander")
    HAS_CLI_FRAMEWORK=true
    CLI_FRAMEWORK="Commander"
    add_resource "typescript" "commander.md"
    add_resource "cli" "commander.md"
  fi

  # Check for Prettier
  if grep -q '"prettier"' package.json 2>/dev/null; then
    HAS_FORMATTER=true
    FORMATTER="Prettier"
  fi

  # Check for tsd
  if grep -q '"tsd"' package.json 2>/dev/null; then
    DETECTED_STACKS+=("tsd")
  fi
fi

# Check for TypeScript
if ls tsconfig*.json >/dev/null 2>&1; then
  DETECTED_STACKS+=("TypeScript")
  CONDITIONAL_AGENTS+=("typescript")
fi

# Check for Ruby
if [[ -f "Gemfile" ]]; then
  DETECTED_STACKS+=("Ruby")
  CONDITIONAL_AGENTS+=("ruby")

  # Check for Sorbet
  if grep -q "sorbet" Gemfile 2>/dev/null; then
    DETECTED_STACKS+=("Sorbet")
    add_resource "ruby" "sorbet.md"
  fi

  # Check for RuboCop
  if [[ -f ".rubocop.yml" ]]; then
    HAS_LINTER=true
    LINTER="RuboCop"
  fi
fi

# Check for Java/JVM
if [[ -f "pom.xml" ]] || [[ -f "build.gradle" ]] || [[ -f "build.gradle.kts" ]]; then
  DETECTED_STACKS+=("Java/JVM")
fi

# Check for Rust
if [[ -f "Cargo.toml" ]]; then
  DETECTED_STACKS+=("Rust")
  HAS_FORMATTER=true
  FORMATTER="rustfmt"
  HAS_TEST_FRAMEWORK=true
  TEST_FRAMEWORK="cargo test"
fi

# Check for Python
if [[ -f "pyproject.toml" ]] || [[ -f "setup.py" ]]; then
  DETECTED_STACKS+=("Python")
  HAS_TEST_FRAMEWORK=true
  TEST_FRAMEWORK="pytest"
fi

# Check for Bazel
if [[ -f "BUILD" ]] || [[ -f "WORKSPACE" ]] || [[ -f ".bazelrc" ]] || [[ -f "BUILD.bazel" ]] || [[ -f "WORKSPACE.bazel" ]]; then
  DETECTED_STACKS+=("Bazel")
  add_resource "code-quality" "bazel.md"
fi

# Check for Nx monorepo
if [[ -f "nx.json" ]]; then
  DETECTED_STACKS+=("Nx")
  add_resource "code-quality" "nx-monorepo.md"
  add_resource "typescript" "nx-monorepo.md"
fi

# Check for Changesets
if [[ -d ".changeset" ]]; then
  DETECTED_STACKS+=("Changesets")
  add_resource "code-quality" "changesets.md"
  add_resource "typescript" "changesets.md"
fi

# Check for API Extractor (root or packages/*/)
if ls api-extractor*.json >/dev/null 2>&1 || ls packages/*/api-extractor*.json >/dev/null 2>&1; then
  DETECTED_STACKS+=("API Extractor")
  API_SURFACE_CHANGES=true
  add_resource "typescript" "api-extractor.md"
  add_resource "api-design" "api-extractor.md"
fi

# Check for GitHub Actions
if [[ -d ".github/workflows" ]] && ls .github/workflows/*.{yml,yaml} >/dev/null 2>&1; then
  DETECTED_STACKS+=("GitHub Actions")
  add_resource "code-quality" "github-actions.md"
fi

# Check for Make
if [[ -f "Makefile" ]]; then
  DETECTED_STACKS+=("Make")
fi

# Check for Vitest (root or packages/*/)
if ls vitest.config.* >/dev/null 2>&1 || ls packages/*/vitest.config.* >/dev/null 2>&1; then
  DETECTED_STACKS+=("Vitest")
  HAS_TEST_FRAMEWORK=true
  TEST_FRAMEWORK="Vitest"
  add_resource "tests" "js-test-frameworks.md"
fi

# Check for Jest (root or packages/*/)
if ls jest.config.* >/dev/null 2>&1 || ls packages/*/jest.config.* >/dev/null 2>&1; then
  DETECTED_STACKS+=("Jest")
  HAS_TEST_FRAMEWORK=true
  TEST_FRAMEWORK="Jest"
  add_resource "tests" "js-test-frameworks.md"
fi

# Check for ESLint (root or packages/*/)
if ls .eslintrc* eslint.config.* >/dev/null 2>&1 || ls packages/*/.eslintrc* packages/*/eslint.config.* >/dev/null 2>&1; then
  DETECTED_STACKS+=("ESLint")
  HAS_LINTER=true
  LINTER="ESLint"
fi

# Check for Prettier config files
if ls .prettierrc* prettier.config.* >/dev/null 2>&1; then
  HAS_FORMATTER=true
  FORMATTER="Prettier"
fi

# Check for API surface changes
if git diff --name-only $(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo HEAD~1) 2>/dev/null | grep -qE '\.(proto|swagger\.|openapi\.)' 2>/dev/null; then
  API_SURFACE_CHANGES=true
fi

# Check if API Extractor files changed
if git diff --name-only $(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo HEAD~1) 2>/dev/null | grep -q 'api-extractor.*\.json' 2>/dev/null; then
  API_SURFACE_CHANGES=true
fi

# Check for proto files
if git diff --name-only $(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo HEAD~1) 2>/dev/null | grep -q '\.proto$' 2>/dev/null; then
  add_resource "api-design" "protobuf.md"
fi

# Add api-design agent if API surface changes detected
if [[ "$API_SURFACE_CHANGES" == "true" ]]; then
  CONDITIONAL_AGENTS+=("api-design")
fi

# Add cli if CLI framework detected
if [[ "$HAS_CLI_FRAMEWORK" == "true" ]]; then
  CONDITIONAL_AGENTS+=("cli")
fi

# Check for large diff
MERGE_BASE=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo HEAD~1)
DIFF_STAT=$(git diff --stat "$MERGE_BASE" 2>/dev/null | tail -1)
if [[ -n "$DIFF_STAT" ]]; then
  # Extract insertions and deletions
  INSERTIONS=$(echo "$DIFF_STAT" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo "0")
  DELETIONS=$(echo "$DIFF_STAT" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo "0")
  TOTAL=$((INSERTIONS + DELETIONS))

  if [[ $TOTAL -gt 500 ]]; then
    LARGE_DIFF=true
  fi
fi

# Check for structural changes (new files or renames)
if git diff --name-status "$MERGE_BASE" 2>/dev/null | grep -qE '^(A|R)' 2>/dev/null; then
  STRUCTURAL_CHANGES=true
fi

# Add architecture and domain-modeling for large diff or structural changes
if [[ "$LARGE_DIFF" == "true" ]] || [[ "$STRUCTURAL_CHANGES" == "true" ]]; then
  CONDITIONAL_AGENTS+=("architecture")
  CONDITIONAL_AGENTS+=("domain-modeling")
fi

# Check if repo is on github.com
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
if echo "$REMOTE_URL" | grep -q 'github\.com'; then
  GITHUB_COM_REPO=true
  CONDITIONAL_AGENTS+=("pr-context")
fi

# Deduplicate and sort an array via sort -u (Bash 3 compatible)
dedup_sort() {
  if [[ $# -eq 0 ]]; then return; fi
  printf '%s\n' "$@" | sort -u
}

# Read deduped values back into arrays using while-read (Bash 3 compatible)
_tmp=()
while IFS= read -r line; do _tmp+=("$line"); done < <(dedup_sort "${DETECTED_STACKS[@]+"${DETECTED_STACKS[@]}"}")
DETECTED_STACKS=("${_tmp[@]+"${_tmp[@]}"}")

_tmp=()
while IFS= read -r line; do _tmp+=("$line"); done < <(dedup_sort "${CONDITIONAL_AGENTS[@]+"${CONDITIONAL_AGENTS[@]}"}")
CONDITIONAL_AGENTS=("${_tmp[@]+"${_tmp[@]}"}")

_tmp=()
while IFS= read -r line; do _tmp+=("$line"); done < <(dedup_sort "${RESOURCES[@]+"${RESOURCES[@]}"}")
RESOURCES=("${_tmp[@]+"${_tmp[@]}"}")

# JSON output helpers
json_array() {
  local first=true
  printf '['
  for item in "$@"; do
    if $first; then first=false; else printf ','; fi
    printf '"%s"' "$item"
  done
  printf ']'
}

# Build resource_map JSON from parallel arrays
json_resource_map() {
  printf '{'
  # Collect unique agents
  local agents_seen=""
  local first_agent=true
  for i in "${!_RMAP_AGENTS[@]}"; do
    local agent="${_RMAP_AGENTS[$i]}"
    # Skip if already processed
    case ",$agents_seen," in
      *,"$agent",*) continue ;;
    esac
    agents_seen="${agents_seen:+$agents_seen,}$agent"

    if $first_agent; then first_agent=false; else printf ','; fi
    printf '"%s":[' "$agent"

    # Collect resources for this agent (deduplicated)
    local resources_seen=""
    local first_resource=true
    for j in "${!_RMAP_AGENTS[@]}"; do
      if [[ "${_RMAP_AGENTS[$j]}" == "$agent" ]]; then
        local resource="${_RMAP_RESOURCES[$j]}"
        case ",$resources_seen," in
          *,"$resource",*) continue ;;
        esac
        resources_seen="${resources_seen:+$resources_seen,}$resource"
        if $first_resource; then first_resource=false; else printf ','; fi
        printf '"%s"' "$resource"
      fi
    done
    printf ']'
  done
  printf '}'
}

# Combine always-on + conditional into a single dispatch list
ALL_AGENTS=("${ALWAYS_ON_AGENTS[@]}" "${CONDITIONAL_AGENTS[@]+"${CONDITIONAL_AGENTS[@]}"}")
_tmp=()
while IFS= read -r line; do _tmp+=("$line"); done < <(dedup_sort "${ALL_AGENTS[@]}")
ALL_AGENTS=("${_tmp[@]+"${_tmp[@]}"}")

cat <<JSONEOF
{
  "stacks": $(json_array "${DETECTED_STACKS[@]+"${DETECTED_STACKS[@]}"}"),
  "agents": $(json_array "${ALL_AGENTS[@]+"${ALL_AGENTS[@]}"}"),
  "resources": $(json_array "${RESOURCES[@]+"${RESOURCES[@]}"}"),
  "resource_map": $(json_resource_map),
  "diff": {
    "large": $LARGE_DIFF,
    "structural_changes": $STRUCTURAL_CHANGES,
    "api_surface_changes": $API_SURFACE_CHANGES
  },
  "tools": {
    "formatter": $(if $HAS_FORMATTER; then printf '"%s"' "$FORMATTER"; else printf 'null'; fi),
    "linter": $(if $HAS_LINTER; then printf '"%s"' "$LINTER"; else printf 'null'; fi),
    "test_framework": $(if $HAS_TEST_FRAMEWORK; then printf '"%s"' "$TEST_FRAMEWORK"; else printf 'null'; fi),
    "cli_framework": $(if $HAS_CLI_FRAMEWORK; then printf '"%s"' "$CLI_FRAMEWORK"; else printf 'null'; fi)
  },
  "github_com_repo": $GITHUB_COM_REPO
}
JSONEOF
