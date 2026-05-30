# GitHub Actions Review Guidance

## What is GitHub Actions?

GitHub Actions is GitHub's CI/CD platform that automates workflows triggered by repository events. Key features:
- **Event-driven**: Triggered by pushes, PRs, releases, schedules, manual dispatch
- **Matrix builds**: Run jobs across multiple OS, language versions, configurations
- **Caching**: Speed up workflows with dependency and build caching
- **Secrets management**: Securely store credentials and tokens
- **Reusable workflows**: Share workflow logic across repositories

## Common Mistakes

### 1. Missing permissions Block

**Problem**: Workflows inherit broad `GITHUB_TOKEN` permissions by default, violating least-privilege principle.

**What to look for**:
```yaml
# ❌ Bad: no permissions block (defaults to broad permissions)
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test

# ✅ Good: explicit minimal permissions
name: CI
on: [push]

permissions:
  contents: read  # Only read access to repository contents

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test

# ✅ Good: job-level permissions override
name: Deploy
on: [push]

permissions:
  contents: read  # Default: read-only

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write  # This job needs write access
      packages: write
    steps:
      - uses: actions/checkout@v4
      - run: npm publish
```

**Permission types**:
- `contents`: Repository content (code, commits, releases)
- `pull-requests`: PRs and reviews
- `issues`: Issues and comments
- `packages`: GitHub Packages (Docker, npm)
- `deployments`: Deployment statuses
- `checks`: Check runs and suites

**Check**:
- Is `permissions` block present at workflow or job level?
- Are permissions minimal (only what's needed)?
- Is `contents: read` the default with job-level overrides for special cases?

### 2. Using actions/checkout Without fetch-depth

**Problem**: Shallow checkout (default `fetch-depth: 1`) breaks git history operations.

**What to look for**:
```yaml
# ❌ Bad: shallow checkout breaks `git diff origin/main`
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: git diff origin/main  # Fails: origin/main doesn't exist!

# ✅ Good: full history when needed
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Fetch full history
      - run: git diff origin/main

# ✅ Good: shallow when history isn't needed
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4  # Default fetch-depth: 1 is fine
      - run: npm test
```

**When full history is needed**:
- Git diff against base branch
- Semantic versioning based on commits
- Changelogs from git history
- Git blame or log operations

**Check**:
- Is `fetch-depth: 0` used when git history is needed?
- Is default shallow checkout used otherwise (faster)?

### 3. Pinning Actions to Branch Instead of SHA

**Problem**: Branch refs (`@main`, `@v1`) can be moved to malicious commits; immutable SHAs are safer.

**What to look for**:
```yaml
# ❌ Bad: pinned to branch (mutable)
steps:
  - uses: actions/checkout@main
  - uses: actions/setup-node@v3

# ⚠️ Acceptable for semver tags (major version)
steps:
  - uses: actions/checkout@v4  # GitHub's official action
  - uses: actions/setup-node@v3

# ✅ Best: pinned to full SHA (immutable)
steps:
  - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1
  - uses: actions/setup-node@60edb5dd545a775178f52524783378180af0d1f8  # v4.0.2
```

**Pinning strategies**:
- **SHA (best)**: Immutable, can't be changed after creation
- **Semver tag (acceptable for official actions)**: `@v3` (major version only)
- **Branch (avoid)**: `@main`, `@master` are mutable

**Check**:
- Are third-party actions pinned to full SHA?
- Are comments explaining which version the SHA corresponds to?
- Are GitHub official actions at least pinned to major version?

### 4. Hardcoded Secrets in Workflow Files

**Problem**: Secrets committed to repository are exposed forever in git history.

**What to look for**:
```yaml
# ❌ Bad: secret in plain text
steps:
  - run: |
      curl -H "Authorization: token $HARDCODED_TOKEN_DO_NOT_DO_THIS" \
        https://api.github.com/repos/user/repo

# ❌ Bad: secret in environment variable value
env:
  API_KEY: HARDCODED_KEY_DO_NOT_DO_THIS

# ✅ Good: secrets from GitHub Secrets
steps:
  - run: |
      curl -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
        https://api.github.com/repos/user/repo
    env:
      API_KEY: ${{ secrets.API_KEY }}
```

**Check**:
- Are all credentials using `${{ secrets.SECRET_NAME }}`?
- Are secrets never hardcoded in workflow files?
- Are secrets scoped appropriately (repo, environment, organization)?

### 5. Missing concurrency Group

**Problem**: Multiple workflow runs for the same branch waste CI resources and race each other.

**What to look for**:
```yaml
# ❌ Bad: PR updates trigger multiple runs that all complete
name: CI
on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test  # If I push 3 times, 3 runs execute fully

# ✅ Good: concurrency group cancels previous runs
name: CI
on: [pull_request]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test  # Only latest run completes

# ✅ Good: concurrency for deployments (don't cancel)
name: Deploy
on:
  push:
    branches: [main]

concurrency:
  group: production-deploy
  cancel-in-progress: false  # Let deploys finish

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
```

**Check**:
- Is `concurrency` set for PR workflows (with `cancel-in-progress: true`)?
- Is `concurrency` set for deploy workflows (with `cancel-in-progress: false`)?
- Is the group key unique per branch/PR (`${{ github.ref }}`)?

### 6. Not Caching Dependencies

**Problem**: Every workflow run downloads all dependencies from scratch (slow and wastes bandwidth).

**What to look for**:
```yaml
# ❌ Bad: no caching (npm ci downloads everything)
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
  - run: npm ci
  - run: npm test

# ✅ Good: cache dependencies
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 18
      cache: 'npm'  # Caches ~/.npm based on package-lock.json hash
  - run: npm ci
  - run: npm test

# ✅ Good: manual cache for custom paths
steps:
  - uses: actions/checkout@v4
  - uses: actions/cache@v4
    with:
      path: |
        ~/.cargo/registry
        ~/.cargo/git
        target
      key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
      restore-keys: |
        ${{ runner.os }}-cargo-
  - run: cargo build
```

**Caching strategies**:
- **Built-in**: `actions/setup-node`, `actions/setup-python`, etc. have `cache` parameter
- **Manual**: Use `actions/cache` for custom cache paths
- **Cache key**: Include file hash (lock file) for correct invalidation

**Check**:
- Is dependency caching enabled?
- Are cache keys based on lock file hashes?
- Are restore-keys provided for partial cache hits?

### 7. Using continue-on-error Too Broadly

**Problem**: Failures are silently ignored, making CI green when it should be red.

**What to look for**:
```yaml
# ❌ Bad: ignoring all test failures
jobs:
  test:
    runs-on: ubuntu-latest
    continue-on-error: true  # Test failures won't fail the workflow!
    steps:
      - run: npm test

# ✅ Good: only ignore failures for specific allowed-to-fail steps
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Run tests
        run: npm test

      - name: Upload coverage (allowed to fail)
        run: bash <(curl -s https://codecov.io/bash)
        continue-on-error: true  # Don't fail workflow if codecov upload fails

# ✅ Good: allowed-to-fail matrix entries
jobs:
  test:
    strategy:
      matrix:
        node: [16, 18, 20, 22]
    runs-on: ubuntu-latest
    continue-on-error: ${{ matrix.node == 22 }}  # v22 is experimental
    steps:
      - run: npm test
```

**Check**:
- Is `continue-on-error: true` used sparingly?
- Are critical steps (tests, builds) not using `continue-on-error`?
- Is it only used for non-critical steps (uploads, notifications)?

### 8. Missing timeout-minutes on Jobs

**Problem**: Stuck jobs run for 6 hours (default timeout), wasting CI resources.

**What to look for**:
```yaml
# ❌ Bad: no timeout (defaults to 360 minutes!)
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test  # If this hangs, runs for 6 hours

# ✅ Good: reasonable timeout
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: npm test  # Fails after 10 minutes if stuck

# ✅ Good: different timeouts for different jobs
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: npm test

  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30  # E2E tests take longer
    steps:
      - run: npm run test:e2e
```

**Recommended timeouts**:
- Unit tests: 5-10 minutes
- Integration tests: 10-20 minutes
- E2E tests: 20-30 minutes
- Builds: 10-20 minutes
- Deployments: 30-60 minutes

**Check**:
- Is `timeout-minutes` set on all jobs?
- Are timeouts reasonable for the job type?
- Are timeouts not too generous (catching hangs early is good)?

### 9. Workflow Dispatch Inputs Without Validation

**Problem**: Manual workflow runs with invalid inputs cause cryptic failures.

**What to look for**:
```yaml
# ❌ Bad: no input validation
on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deployment environment'
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh ${{ inputs.environment }}  # What if input is "prod && rm -rf /"?

# ✅ Good: validated choice input
on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deployment environment'
        required: true
        type: choice
        options:
          - dev
          - staging
          - production

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh ${{ inputs.environment }}

# ✅ Good: runtime validation
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to deploy (semver)'
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Validate version input
        run: |
          if [[ ! "${{ inputs.version }}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "Invalid version format. Must be semver (e.g., 1.2.3)"
            exit 1
          fi
      - run: ./deploy.sh ${{ inputs.version }}
```

**Check**:
- Are workflow inputs validated (type: choice for enums)?
- Are free-text inputs validated at runtime?
- Are required inputs marked `required: true`?

### 10. Unsafe Use of pull_request_target

**Problem**: `pull_request_target` runs in the context of the base branch with write permissions, even for untrusted forks.

**What to look for**:
```yaml
# ❌ DANGEROUS: checking out PR code in pull_request_target context
name: Dangerous
on: pull_request_target

jobs:
  danger:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}  # Untrusted code!
      - run: npm install  # Could install malicious packages!
      - run: npm run build  # Executes untrusted code with write permissions!

# ✅ Safe: pull_request_target only for safe operations
name: Label PR
on: pull_request_target

permissions:
  pull-requests: write

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      # No checkout of PR code!
      - uses: actions/labeler@v4

# ✅ Safe: use pull_request for untrusted code
name: Test PR
on: pull_request  # Not pull_request_target

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4  # Safe: read-only context
      - run: npm test
```

**When to use each**:
- `pull_request`: Default for most CI (read-only, safe for untrusted code)
- `pull_request_target`: Only for labeling, commenting (never checkout PR code)

**Check**:
- Is `pull_request_target` used?
- If yes, is PR code being checked out? (DANGEROUS)
- Could this be `pull_request` instead?

## What Good Looks Like

### Secure, Efficient CI Workflow

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1

      - uses: actions/setup-node@60edb5dd545a775178f52524783378180af0d1f8  # v4.0.2
        with:
          node-version: 18
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test

      - name: Upload coverage
        if: always()
        uses: codecov/codecov-action@v4
        continue-on-error: true

  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs: test

    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1

      - uses: actions/setup-node@60edb5dd545a775178f52524783378180af0d1f8  # v4.0.2
        with:
          node-version: 18
          cache: 'npm'

      - run: npm ci
      - run: npm run build

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
          retention-days: 7
```

### Matrix Build with Caching

```yaml
name: Test

on: [push, pull_request]

permissions:
  contents: read

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [16, 18, 20]
        exclude:
          - os: windows-latest
            node: 16  # Skip this combination

    runs-on: ${{ matrix.os }}
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'

      - run: npm ci
      - run: npm test
```

### Reusable Workflow

```yaml
# .github/workflows/reusable-test.yml
name: Reusable Test

on:
  workflow_call:
    inputs:
      node-version:
        required: true
        type: string
    secrets:
      npm-token:
        required: false

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
          cache: 'npm'
      - run: npm ci
        env:
          NPM_TOKEN: ${{ secrets.npm-token }}
      - run: npm test

# .github/workflows/ci.yml
name: CI
on: [push]

jobs:
  test-node-18:
    uses: ./.github/workflows/reusable-test.yml
    with:
      node-version: '18'

  test-node-20:
    uses: ./.github/workflows/reusable-test.yml
    with:
      node-version: '20'
```

## Review Checklist

### Security
- [ ] Is `permissions` block present with minimal permissions?
- [ ] Are actions pinned to SHA (or at least major version)?
- [ ] Are secrets using `${{ secrets.* }}` (never hardcoded)?
- [ ] Is `pull_request_target` used safely (not checking out PR code)?

### Performance
- [ ] Is dependency caching enabled?
- [ ] Is `concurrency` set for PR workflows?
- [ ] Are jobs running in parallel where possible?
- [ ] Are matrix builds used for multi-platform/version testing?

### Reliability
- [ ] Is `timeout-minutes` set on all jobs?
- [ ] Is `continue-on-error` used sparingly?
- [ ] Is `fetch-depth: 0` used when git history is needed?
- [ ] Are workflow inputs validated?

### Maintainability
- [ ] Are reusable workflows used for repeated logic?
- [ ] Are job/step names descriptive?
- [ ] Are artifacts uploaded with appropriate retention?

## Common Anti-Patterns to Flag

1. **No permissions block**: Broad default permissions
2. **Branch-pinned actions**: Mutable action refs
3. **Hardcoded secrets**: Credentials in workflow files
4. **No caching**: Slow builds downloading dependencies every time
5. **No concurrency control**: Wasted CI resources on cancelled work
6. **No timeout**: Jobs hanging for 6 hours
7. **Unsafe pull_request_target**: Executing untrusted code with write permissions
8. **continue-on-error everywhere**: Silently ignoring failures

## References

- [GitHub Actions Security Best Practices](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [Workflow Syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
- [Caching Dependencies](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)
- [Using Concurrency](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#concurrency)
