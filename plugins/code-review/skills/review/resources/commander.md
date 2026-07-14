# Commander.js CLI Review Guidance

## Overview

Commander.js is the complete solution for Node.js command-line interfaces. It provides command parsing, option definitions, help generation, and subcommands with a fluent API.

**Core features:**
- Fluent API with method chaining
- Automatic help generation
- Git-style subcommands
- Variadic arguments
- TypeScript support

## Common Mistakes

### 1. Using `.action()` Without Handling Async Errors

**Problem:** Async action callbacks that don't handle errors properly cause unhandled promise rejections.

**Anti-pattern:**
```javascript
// ❌ Bad: async errors are unhandled
program
  .command('deploy')
  .action(async (options) => {
    const result = await deployApp(options);  // If this throws, it's unhandled
    console.log(result);
  });

program.parse();
```

**Correct pattern:**
```javascript
// ✅ Good: wrap in try-catch or use error handler
program
  .command('deploy')
  .action(async (options) => {
    try {
      const result = await deployApp(options);
      console.log(result);
    } catch (error) {
      console.error(`Deployment failed: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();
```

**Alternative: Global error handler:**
```javascript
program
  .command('deploy')
  .action(async (options) => {
    await deployApp(options);  // Errors caught by exitOverride
  });

program
  .exitOverride((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(err.exitCode || 1);
  })
  .parseAsync();  // Use parseAsync() for async actions
```

### 2. Using `.parse()` Instead of `.parseAsync()` for Async Actions

**Problem:** Using `.parse()` with async actions doesn't wait for them to complete.

**Anti-pattern:**
```javascript
// ❌ Bad: parse() doesn't wait for async actions
program
  .command('build')
  .action(async () => {
    await longRunningBuild();
  });

program.parse();  // Exits before build completes
```

**Correct pattern:**
```javascript
// ✅ Good: parseAsync() waits for async actions
program
  .command('build')
  .action(async () => {
    await longRunningBuild();
  });

await program.parseAsync();  // Or: program.parseAsync().catch(...)
```

### 3. Option Value Processing Not Handling Edge Cases

**Problem:** Custom option parsers don't validate inputs or handle errors.

**Anti-pattern:**
```javascript
// ❌ Bad: no validation, parseInt can return NaN
program
  .option('-p, --port <number>', 'port number', parseInt);
```

**Correct pattern:**
```javascript
// ✅ Good: validate parsed value
program
  .option('-p, --port <number>', 'port number', (value) => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      throw new commander.InvalidArgumentError('Port must be a number');
    }
    if (parsed < 1 || parsed > 65535) {
      throw new commander.InvalidArgumentError('Port must be between 1 and 65535');
    }
    return parsed;
  });
```

**Built-in parsers (Commander v9+):**
```javascript
// ✅ Good: use built-in parsers
import { program } from 'commander';

program
  .option('-p, --port <number>', 'port number', program.parseFloat)
  .option('-c, --count <number>', 'count', program.parseInt);
```

### 4. Not Setting `.exitOverride()` for Testability

**Problem:** Commander calls `process.exit()` by default, making tests exit the process.

**Anti-pattern:**
```javascript
// ❌ Bad: can't test because it calls process.exit()
const program = new Command();
program
  .option('-p, --port <number>', 'port')
  .parse(process.argv);

// Test will exit the process on validation errors
```

**Correct pattern:**
```javascript
// ✅ Good: use exitOverride for testing
export function createCLI(argv = process.argv) {
  const program = new Command();
  
  program
    .exitOverride()  // Throw instead of calling process.exit()
    .option('-p, --port <number>', 'port')
    .parse(argv);
    
  return program;
}

// In production
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    createCLI();
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode || 1);
  }
}
```

### 5. Missing `.version()` on the Program

**Problem:** CLI doesn't support `--version` flag.

**Anti-pattern:**
```javascript
// ❌ Bad: no version information
const program = new Command();
program
  .name('myapp')
  .description('My application');
```

**Correct pattern:**
```javascript
// ✅ Good: includes version
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

const program = new Command();
program
  .name('myapp')
  .description('My application')
  .version(pkg.version);  // Enables --version flag
```

### 6. Custom Help Not Using `.addHelpText()` Properly

**Problem:** Custom help text is added in ways that don't integrate with Commander's help system.

**Anti-pattern:**
```javascript
// ❌ Bad: replaces built-in help completely
program
  .helpInformation = () => {
    return 'Custom help only';  // Loses all auto-generated help
  };
```

**Correct pattern:**
```javascript
// ✅ Good: augment existing help
program
  .addHelpText('after', `

Examples:
  $ myapp deploy --env production
  $ myapp build --watch`);

// ✅ Good: add help section
program
  .addHelpText('beforeAll', 'My Application v1.0.0\n')
  .addHelpText('after', '\nFor more info, visit https://example.com/docs');
```

### 7. Not Using `.showHelpAfterError()` for Better UX

**Problem:** Error messages don't give users a hint about how to get help.

**Anti-pattern:**
```javascript
// ❌ Bad: error with no guidance
program
  .option('-c, --config <path>', 'config file', validateConfig)
  .parse();

// User error shows: "error: invalid config path"
// No hint about using --help
```

**Correct pattern:**
```javascript
// ✅ Good: show help hint after errors
program
  .showHelpAfterError('(add --help for additional information)')
  .option('-c, --config <path>', 'config file', validateConfig)
  .parse();

// User error now shows:
// "error: invalid config path"
// "(add --help for additional information)"
```

## What to Check During Review

### 1. Async Action Handling

**Checklist:**
- [ ] Async actions use `.parseAsync()` not `.parse()`
- [ ] Async actions have try-catch error handling
- [ ] Errors are logged with useful context
- [ ] Exit codes are set appropriately

**Pattern to look for:**
```javascript
// ✅ Correct async pattern
program
  .command('build')
  .action(async (options) => {
    try {
      await build(options);
      console.log('Build successful');
    } catch (error) {
      console.error(`Build failed: ${error.message}`);
      process.exit(1);
    }
  });

await program.parseAsync();
```

### 2. Option Parsers

**Check that:**
- [ ] Custom parsers validate input
- [ ] Parsers throw `InvalidArgumentError` for bad input
- [ ] Built-in parsers are used where appropriate
- [ ] Default values are sensible

**Examples:**
```javascript
// ✅ Good: validated custom parser
.option('-p, --port <number>', 'port', (value) => {
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new commander.InvalidArgumentError('Port must be 1-65535');
  }
  return port;
})

// ✅ Good: built-in parser
.option('-t, --timeout <seconds>', 'timeout', program.parseFloat)

// ✅ Good: with default
.option('-p, --port <number>', 'port', parseInt, 3000)
```

### 3. Error Handling Configuration

**Check for:**
- [ ] `.exitOverride()` is set for testable CLIs
- [ ] `.showHelpAfterError()` provides user guidance
- [ ] `.configureOutput()` for custom error formatting (if needed)

**Example:**
```javascript
// ✅ Good: comprehensive error handling
program
  .exitOverride((err) => {
    if (err.code === 'commander.invalidArgument') {
      console.error(`Error: ${err.message}`);
    }
    throw err;
  })
  .showHelpAfterError('(add --help for additional information)')
  .configureOutput({
    writeErr: (str) => process.stderr.write(`[ERROR] ${str}`),
  });
```

### 4. Version Information

**Check that:**
- [ ] `.version()` is called with package version
- [ ] Custom version flag description (if needed)

**Example:**
```javascript
// ✅ Good: version from package.json
import pkg from './package.json' assert { type: 'json' };

program
  .version(pkg.version)
  .version(pkg.version, '-v, --version', 'output the current version');
```

### 5. Help Text Quality

**Check for:**
- [ ] `.description()` on program and commands
- [ ] `.addHelpText()` for examples
- [ ] Meaningful option descriptions
- [ ] `.showHelpAfterError()` for user guidance

**Example:**
```javascript
// ✅ Good: comprehensive help
program
  .name('myapp')
  .description('My application for doing things')
  .addHelpText('after', `

Examples:
  $ myapp deploy --env production
  $ myapp build --watch
  $ myapp test --coverage

For more information, visit https://example.com/docs`);

program
  .command('deploy')
  .description('Deploy the application')
  .option('-e, --env <name>', 'target environment (dev, staging, prod)')
  .option('--dry-run', 'preview deployment without executing')
  .action(async (options) => { /* ... */ });
```

### 6. Command Structure

**Check that:**
- [ ] Commands have clear descriptions
- [ ] Subcommands are properly nested
- [ ] Options are scoped correctly (global vs command-specific)

**Example:**
```javascript
// ✅ Good: clear structure
program
  .name('myapp')
  .description('My application');

// Global options
program
  .option('-v, --verbose', 'verbose output')
  .option('-c, --config <path>', 'config file');

// Subcommands with their own options
program
  .command('deploy')
  .description('Deploy the application')
  .option('-e, --env <name>', 'environment')
  .action(async (options) => { /* ... */ });

program
  .command('build')
  .description('Build the application')
  .option('-w, --watch', 'watch mode')
  .action(async (options) => { /* ... */ });
```

### 7. Argument Handling

**Check for:**
- [ ] Arguments have descriptive names
- [ ] Variadic arguments use `[items...]` or `<items...>`
- [ ] Optional vs required arguments are clear
- [ ] `.argument()` with validators for complex types

**Examples:**
```javascript
// ✅ Good: clear argument definitions
program
  .command('copy')
  .description('Copy files')
  .argument('<source>', 'source file')
  .argument('<destination>', 'destination file')
  .action((source, destination) => {
    console.log(`Copying ${source} to ${destination}`);
  });

// ✅ Good: variadic arguments
program
  .command('merge')
  .description('Merge multiple files')
  .argument('<target>', 'target file')
  .argument('[sources...]', 'source files')
  .action((target, sources) => {
    console.log(`Merging ${sources.join(', ')} into ${target}`);
  });

// ✅ Good: validated argument
program
  .command('connect')
  .argument('<url>', 'connection URL', (value) => {
    const url = new URL(value);  // Throws if invalid
    return url;
  })
  .action((url) => {
    console.log(`Connecting to ${url.hostname}`);
  });
```

## Action Handler Patterns

### Sync Actions

**Pattern:**
```javascript
program
  .command('greet <name>')
  .action((name, options) => {
    console.log(`Hello, ${name}!`);
    if (options.verbose) {
      console.log('Verbose mode enabled');
    }
  });

program.parse();
```

### Async Actions

**Pattern:**
```javascript
program
  .command('deploy')
  .action(async (options) => {
    try {
      console.log('Starting deployment...');
      await deployApplication(options);
      console.log('Deployment successful');
    } catch (error) {
      console.error(`Deployment failed: ${error.message}`);
      process.exit(1);
    }
  });

await program.parseAsync();
```

### Error Handling in Actions

**Pattern:**
```javascript
program
  .command('process <file>')
  .action(async (file, options) => {
    if (!fs.existsSync(file)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }
    
    try {
      const result = await processFile(file, options);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Processing failed: ${error.message}`);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });
```

## Testing Commander Programs

### Testable Structure

**Pattern:**
```javascript
// cli.js
export function createProgram() {
  const program = new Command();
  
  program
    .name('myapp')
    .exitOverride()  // For testing
    .option('-n, --name <name>', 'name to greet')
    .action((options) => {
      console.log(`Hello, ${options.name || 'World'}!`);
    });
    
  return program;
}

// Production entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const program = createProgram();
    program.parse();
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode || 1);
  }
}
```

**Test:**
```javascript
import { createProgram } from './cli.js';

test('greet with name', () => {
  const program = createProgram();
  
  // Capture output
  const output = [];
  const log = (msg) => output.push(msg);
  console.log = log;
  
  program.parse(['node', 'cli.js', '--name', 'Alice']);
  
  expect(output).toContain('Hello, Alice!');
});

test('error on invalid option', () => {
  const program = createProgram();
  
  expect(() => {
    program.parse(['node', 'cli.js', '--invalid']);
  }).toThrow();
});
```

### Testing Async Commands

**Pattern:**
```javascript
import { createProgram } from './cli.js';

test('async command completes', async () => {
  const program = createProgram();
  
  await expect(
    program.parseAsync(['node', 'cli.js', 'deploy', '--env', 'test'])
  ).resolves.not.toThrow();
});
```

## Configuration Best Practices

### Recommended Setup

**Pattern:**
```javascript
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

export function createProgram() {
  const program = new Command();
  
  return program
    .name(pkg.name)
    .description(pkg.description)
    .version(pkg.version)
    .showHelpAfterError('(add --help for additional information)')
    .exitOverride()
    .addHelpText('after', `

Examples:
  $ ${pkg.name} deploy --env production
  $ ${pkg.name} build --watch

For more information, visit ${pkg.homepage}`);
}
```

### Global Options Pattern

**Pattern:**
```javascript
const program = createProgram();

// Global options available to all commands
program
  .option('-v, --verbose', 'verbose output')
  .option('-c, --config <path>', 'config file path')
  .option('--dry-run', 'preview mode without making changes');

// Access global options in commands
program
  .command('deploy')
  .action((options, command) => {
    const globalOpts = command.parent.opts();
    if (globalOpts.verbose) {
      console.log('Verbose mode enabled');
    }
  });
```

## Review Checklist

**For every Commander.js PR:**

1. **Async handling:**
   - [ ] Async actions use `.parseAsync()`
   - [ ] Async actions have try-catch blocks
   - [ ] Errors are logged with context
   - [ ] Exit codes are set appropriately

2. **Option parsers:**
   - [ ] Custom parsers validate input
   - [ ] Parsers throw `InvalidArgumentError`
   - [ ] Built-in parsers used where appropriate
   - [ ] Defaults are sensible

3. **Error configuration:**
   - [ ] `.exitOverride()` for testable code
   - [ ] `.showHelpAfterError()` for UX
   - [ ] Custom error formatting (if needed)

4. **Help text:**
   - [ ] `.version()` is set
   - [ ] `.description()` on program and commands
   - [ ] `.addHelpText()` with examples
   - [ ] Option descriptions are clear

5. **Command structure:**
   - [ ] Commands have descriptions
   - [ ] Arguments are validated
   - [ ] Options are scoped correctly
   - [ ] Help is comprehensive

6. **Testing:**
   - [ ] CLI is exported for testing
   - [ ] Uses `.exitOverride()` in tests
   - [ ] Tests cover error cases

## Resources

- [Commander.js documentation](https://github.com/tj/commander.js)
- [Commander.js API reference](https://github.com/tj/commander.js/blob/master/docs/api.md)
- [Examples](https://github.com/tj/commander.js/tree/master/examples)
