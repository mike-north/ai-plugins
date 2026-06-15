# Nx Monorepo Review Guidance

## What is Nx?

Nx is a smart monorepo build system that uses a dependency graph to understand your workspace structure. It enables:
- **Incremental builds**: Only rebuild what changed
- **Intelligent caching**: Local and distributed caching of task outputs
- **Code generation**: Generators scaffold consistent project structures
- **Affected command detection**: Automatically test/build/lint only impacted projects
- **Module boundaries**: Enforce architectural constraints via ESLint

**Key concepts:**
- **Projects**: Apps and libraries in your workspace
- **Targets**: Buildable/runnable tasks (build, test, lint, serve)
- **Tags**: Used for enforcing module boundaries
- **Dependency graph**: Derived from imports and implicit dependencies
- **Affected**: Determines which projects changed based on git diff

## Common Mistakes

### 1. Missing or Misconfigured Module Boundaries

**Problem**: Without the `enforce-module-boundaries` ESLint rule, developers can import from any project, creating circular dependencies and tight coupling.

**What to look for**:
```typescript
// ❌ BAD: App importing from another app
// apps/admin/src/index.ts
import { helper } from '../../customer-portal/src/utils';

// ❌ BAD: Library importing from higher layer
// libs/data-access/src/index.ts
import { Button } from '@myorg/ui-components'; // data-access shouldn't depend on UI

// ❌ BAD: Feature library importing from different scope without permission
// libs/checkout/feature-cart/src/index.ts
import { AdminService } from '@myorg/admin-data-access'; // scope violation
```

**Solution**: Configure `@nx/enforce-module-boundaries` in `.eslintrc.json`:

```json
{
  "overrides": [
    {
      "files": ["*.ts", "*.tsx"],
      "rules": {
        "@nx/enforce-module-boundaries": [
          "error",
          {
            "enforceBuildableLibDependency": true,
            "allow": [],
            "depConstraints": [
              {
                "sourceTag": "type:app",
                "onlyDependOnLibsWithTags": ["type:feature", "type:ui", "type:util"]
              },
              {
                "sourceTag": "type:feature",
                "onlyDependOnLibsWithTags": ["type:ui", "type:data-access", "type:util"]
              },
              {
                "sourceTag": "type:data-access",
                "onlyDependOnLibsWithTags": ["type:util"]
              },
              {
                "sourceTag": "type:ui",
                "onlyDependOnLibsWithTags": ["type:util"]
              },
              {
                "sourceTag": "type:util",
                "onlyDependOnLibsWithTags": ["type:util"]
              },
              {
                "sourceTag": "scope:shared",
                "onlyDependOnLibsWithTags": ["scope:shared"]
              },
              {
                "sourceTag": "scope:checkout",
                "onlyDependOnLibsWithTags": ["scope:checkout", "scope:shared"]
              }
            ]
          }
        ]
      }
    }
  ]
}
```

**Check**:
- Is `@nx/enforce-module-boundaries` enabled in ESLint config?
- Are `depConstraints` defined with appropriate rules?
- Do all projects have appropriate `tags` in `project.json`?
- Are imports respecting the defined boundaries?

### 2. Incorrect project.json Configuration

**Problem**: Missing or incorrect `inputs`, `outputs`, or `dependsOn` configuration breaks caching and task orchestration.

**What to look for**:
```json
// ❌ BAD: Missing inputs means cache won't invalidate on config changes
{
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"]
      // Missing: "inputs": ["production", "^production"]
    }
  }
}

// ❌ BAD: Missing dependsOn means dependencies aren't built first
{
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "inputs": ["production", "^production"]
      // Missing: "dependsOn": ["^build"]
    }
  }
}

// ❌ BAD: Missing outputs means build artifacts aren't cached
{
  "targets": {
    "build": {
      "executor": "@nx/webpack:webpack",
      "inputs": ["production", "^production"]
      // Missing: "outputs": ["{options.outputPath}"]
    }
  }
}
```

**Solution**:
```json
// ✅ GOOD: Complete configuration
{
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "inputs": ["production", "^production"],
      "dependsOn": ["^build"]
    },
    "test": {
      "executor": "@nx/jest:jest",
      "outputs": ["{workspaceRoot}/coverage/{projectRoot}"],
      "inputs": ["default", "^production", "{workspaceRoot}/jest.preset.js"],
      "dependsOn": ["build"]
    }
  }
}
```

**Input namedsets**:
- `default`: All source files except production files
- `production`: Source files (src/**) but not tests
- `^production`: Production files from dependencies

**Check**:
- Are `outputs` arrays specified for all targets that produce artifacts?
- Are `inputs` defined (or inherited from `targetDefaults`)?
- Do inputs include `^production` for dependencies that need to be built first?
- Are `dependsOn` relationships correct?

### 3. Not Using nx affected in CI

**Problem**: Running all tests/builds on every commit wastes CI time and resources.

**What to look for**:
```yaml
# ❌ BAD: Builds everything on every commit
- name: Build
  run: npx nx run-many -t build --all

# ❌ BAD: Tests everything
- name: Test
  run: npx nx run-many -t test --all
```

**Solution**:
```yaml
# ✅ GOOD: Only build/test affected projects
- name: Setup SHAs
  run: |
    echo "BASE=$(git merge-base origin/main HEAD)" >> $GITHUB_ENV
    echo "HEAD=HEAD" >> $GITHUB_ENV

- name: Build affected
  run: npx nx affected -t build --base=${{ env.BASE }} --head=${{ env.HEAD }}

- name: Test affected
  run: npx nx affected -t test --base=${{ env.BASE }} --head=${{ env.HEAD }} --parallel=3

- name: Lint affected
  run: npx nx affected -t lint --base=${{ env.BASE }} --head=${{ env.HEAD }}
```

**Check**:
- Does CI use `nx affected` instead of running all projects?
- Is the `--base` ref correct (usually `origin/main`)?
- Are parallel workers configured appropriately (`--parallel=N`)?
- Is `--head` set correctly (usually `HEAD`)?

### 4. Incorrect Cache Configuration

**Problem**: Cache inputs don't include all files that affect output, or outputs don't capture all generated files.

**What to look for**:
```json
// ❌ BAD: Doesn't include environment files that affect build
{
  "targets": {
    "build": {
      "executor": "@nx/webpack:webpack",
      "inputs": ["production", "^production"],
      "outputs": ["{options.outputPath}"]
      // Missing: .env files, config files
    }
  }
}

// ❌ BAD: Doesn't include generated source maps in outputs
{
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "inputs": ["production", "^production"],
      "outputs": ["{options.outputPath}"]
      // Missing: source maps, manifest files
    }
  }
}
```

**Solution**:
```json
// ✅ GOOD: Includes all relevant inputs
{
  "targets": {
    "build": {
      "executor": "@nx/webpack:webpack",
      "inputs": [
        "production",
        "^production",
        "{projectRoot}/.env",
        "{projectRoot}/.env.production",
        "{projectRoot}/webpack.config.js",
        { "externalDependencies": ["webpack"] }
      ],
      "outputs": [
        "{options.outputPath}",
        "{options.outputPath}/**/*.map",
        "{options.outputPath}/manifest.json"
      ]
    }
  }
}
```

**Check**:
- Are environment variables that affect build output included in inputs?
- Are configuration files (webpack.config, vite.config) included?
- Are all output files captured (source maps, assets, manifests)?
- Are external dependencies declared when version matters?

### 5. Missing Implicit Dependencies

**Problem**: Projects depend on each other but don't import code (e.g., E2E apps testing other apps), so Nx doesn't detect the relationship.

**What to look for**:
```json
// ❌ BAD: E2E app doesn't declare dependency on app it tests
// apps/admin-e2e/project.json
{
  "name": "admin-e2e",
  "targets": {
    "e2e": {
      "executor": "@nx/cypress:cypress",
      "options": {
        "devServerTarget": "admin:serve"
        // Nx doesn't know admin-e2e depends on admin!
      }
    }
  }
}
```

**Solution**:
```json
// ✅ GOOD: Explicit implicit dependency
// apps/admin-e2e/project.json
{
  "name": "admin-e2e",
  "implicitDependencies": ["admin"],
  "targets": {
    "e2e": {
      "executor": "@nx/cypress:cypress",
      "options": {
        "devServerTarget": "admin:serve"
      }
    }
  }
}
```

**When implicit dependencies are needed**:
- E2E apps testing other apps
- Shared configuration files in workspace root
- Global types or constants in non-standard locations
- Build scripts that read from shared directories

**Check**:
- Do E2E apps declare implicit dependencies on apps they test?
- Do projects reading workspace root config have implicit dependencies?
- Are shared fixtures declared as dependencies?

### 6. Generators Not Updating Dependency Graph

**Problem**: Custom generators create files but don't update `project.json` or imports correctly.

**What to look for**:
```typescript
// ❌ BAD: Generator creates files but doesn't update project graph
import { Tree, generateFiles } from '@nx/devkit';

export default async function (tree: Tree, options: Schema) {
  const projectRoot = `libs/${options.name}`;
  generateFiles(tree, join(__dirname, 'files'), projectRoot, options);
  // Missing: Add to workspace, configure targets
  await formatFiles(tree);
}
```

**Solution**:
```typescript
// ✅ GOOD: Generator properly configures project
import { Tree, generateFiles, addProjectConfiguration, formatFiles } from '@nx/devkit';

export default async function (tree: Tree, options: Schema) {
  const projectRoot = `libs/${options.name}`;

  // Add project to workspace
  addProjectConfiguration(tree, options.name, {
    root: projectRoot,
    projectType: 'library',
    sourceRoot: `${projectRoot}/src`,
    targets: {
      build: {
        executor: '@nx/js:tsc',
        outputs: ['{options.outputPath}'],
        options: {
          outputPath: `dist/${projectRoot}`,
          main: `${projectRoot}/src/index.ts`,
          tsConfig: `${projectRoot}/tsconfig.lib.json`
        }
      },
      test: {
        executor: '@nx/jest:jest',
        outputs: ['{workspaceRoot}/coverage/{projectRoot}'],
        options: {
          jestConfig: `${projectRoot}/jest.config.ts`
        }
      }
    },
    tags: options.tags || []
  });

  generateFiles(tree, join(__dirname, 'files'), projectRoot, options);
  await formatFiles(tree);
}
```

**Check**:
- Do generators call `addProjectConfiguration` for new projects?
- Do generators call `updateProjectConfiguration` when modifying projects?
- Do generators add appropriate tags?
- Do generators respect existing naming conventions?

### 7. Not Using nx.json targetDefaults

**Problem**: Duplicating the same configuration across many `project.json` files.

**What to look for**:
```json
// ❌ BAD: Every project.json repeats the same test configuration
// libs/feature-a/project.json
{
  "targets": {
    "test": {
      "executor": "@nx/jest:jest",
      "outputs": ["{workspaceRoot}/coverage/{projectRoot}"],
      "inputs": ["default", "^production", "{workspaceRoot}/jest.preset.js"]
    }
  }
}
// ...repeated in 50 other project.json files
```

**Solution**:
```json
// ✅ GOOD: Define shared config in nx.json
// nx.json
{
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["production", "^production"],
      "cache": true
    },
    "test": {
      "inputs": ["default", "^production", "{workspaceRoot}/jest.preset.js"],
      "outputs": ["{workspaceRoot}/coverage/{projectRoot}"],
      "cache": true
    },
    "lint": {
      "inputs": ["default", "{workspaceRoot}/.eslintrc.json"],
      "cache": true
    }
  }
}

// Now project.json only needs executor
// libs/feature-a/project.json
{
  "targets": {
    "test": {
      "executor": "@nx/jest:jest"
    }
  }
}
```

**Check**:
- Is repeated configuration extracted to `targetDefaults`?
- Are project-specific overrides minimal?
- Are `inputs`, `outputs`, `dependsOn` defined at the workspace level?

## What Good Looks Like

### Clean Layered Architecture

```
libs/
├── shared/
│   ├── data-access/          # Tags: type:data-access, scope:shared
│   │   └── api-client/
│   ├── ui/                   # Tags: type:ui, scope:shared
│   │   └── button/
│   └── util/                 # Tags: type:util, scope:shared
│       └── formatting/
├── checkout/
│   ├── feature/              # Tags: type:feature, scope:checkout
│   │   └── cart/
│   ├── data-access/          # Tags: type:data-access, scope:checkout
│   │   └── cart-service/
│   └── ui/                   # Tags: type:ui, scope:checkout
│       └── cart-item/
```

### Well-Configured project.json

```json
{
  "name": "checkout-feature-cart",
  "tags": ["type:feature", "scope:checkout"],
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/checkout/feature/cart",
        "main": "libs/checkout/feature/cart/src/index.ts",
        "tsConfig": "libs/checkout/feature/cart/tsconfig.lib.json"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": {
        "jestConfig": "libs/checkout/feature/cart/jest.config.ts",
        "passWithNoTests": true
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint",
      "options": {
        "lintFilePatterns": ["libs/checkout/feature/cart/**/*.ts"]
      }
    }
  }
}
```

### Efficient CI Pipeline

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  main:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      - name: Set SHAs for nx affected
        run: |
          echo "BASE=$(git merge-base origin/main HEAD)" >> $GITHUB_ENV
          echo "HEAD=HEAD" >> $GITHUB_ENV

      - name: Lint affected
        run: npx nx affected -t lint --base=${{ env.BASE }} --head=${{ env.HEAD }}

      - name: Test affected
        run: npx nx affected -t test --base=${{ env.BASE }} --head=${{ env.HEAD }} --parallel=3 --ci

      - name: Build affected
        run: npx nx affected -t build --base=${{ env.BASE }} --head=${{ env.HEAD }}
```

## Review Checklist

### New Projects
- [ ] Does the project have appropriate tags?
- [ ] Are tags consistent with existing conventions?
- [ ] Is the project name following the workspace naming scheme?
- [ ] Are all targets configured (build, test, lint at minimum)?
- [ ] Are outputs declared for build targets?
- [ ] Does the project respect module boundaries?

### Modified Projects
- [ ] If dependencies changed, are they allowed by boundary rules?
- [ ] If new targets added, are inputs/outputs configured?
- [ ] If shared config changed, are implicit dependencies updated?

### CI/CD Changes
- [ ] Is `nx affected` used instead of `run-many --all`?
- [ ] Is the base ref correct for the affected command?
- [ ] Is caching enabled?
- [ ] Are parallel workers configured appropriately?

### Generator/Plugin Changes
- [ ] Does the generator update project configuration correctly?
- [ ] Does it respect existing tag conventions?
- [ ] Does it create properly configured targets?
- [ ] Is the generated code consistent with existing patterns?

## Common Anti-Patterns to Flag

1. **Direct file imports bypassing boundaries**: `import { X } from '../../../other-lib/src/index'`
2. **Broad visibility with no tags**: Every project can import from every other project
3. **Missing cache configuration**: Slow CI with no caching
4. **Duplicate configuration**: Same target config copy-pasted across projects
5. **Incorrect affected detection**: Not using `nx affected` in CI
6. **Missing outputs**: Build targets without declared output paths
7. **Implicit dependencies via global state**: Projects coupling through undeclared shared resources

## References

- [Nx Module Boundaries](https://nx.dev/core-features/enforce-module-boundaries)
- [Nx Task Pipeline Configuration](https://nx.dev/concepts/task-pipeline-configuration)
- [Nx Affected Commands](https://nx.dev/ci/features/affected)
- [Nx Caching](https://nx.dev/concepts/how-caching-works)
