# Yargs CLI Review Guidance

## Overview

Yargs is a popular Node.js library for building command-line interfaces. It provides argument parsing, command routing, validation, and automatic help text generation.

**Core features:**
- Fluent API with method chaining
- Command-based routing with builder pattern
- Automatic type coercion and validation
- Built-in help and version commands
- Middleware support

## Common Mistakes

### 1. Not Using `.strict()`

**Problem:** Yargs accepts unknown options silently by default, causing user typos to go unnoticed.

**Anti-pattern:**
```javascript
// ❌ Bad: typos are silently ignored
const argv = yargs(hideBin(process.argv))
  .option('verbose', { type: 'boolean' })
  .parse();

// User types: --verbos
// Yargs silently accepts it, verbose remains undefined
```

**Correct pattern:**
```javascript
// ✅ Good: strict mode catches typos
const argv = yargs(hideBin(process.argv))
  .option('verbose', { type: 'boolean' })
  .strict()  // Fail on unknown options
  .parse();

// User types: --verbos
// Yargs errors: "Unknown argument: verbos. Did you mean verbose?"
```

**What to check:** Every yargs setup should have `.strict()` unless there's a specific reason to accept unknown options.

### 2. Type Coercion Surprises

**Problem:** Yargs coerces arguments to strings by default, causing subtle bugs when you expect numbers or booleans.

**Anti-pattern:**
```javascript
// ❌ Bad: count is a string, not a number
const argv = yargs(hideBin(process.argv))
  .option('count')
  .parse();

// User types: --count 10
// argv.count is "10" (string), not 10 (number)
if (argv.count > 5) { /* This comparison is wrong! */ }
```

**Correct pattern:**
```javascript
// ✅ Good: explicit type coercion
const argv = yargs(hideBin(process.argv))
  .option('count', { type: 'number' })
  .parse();

// Now argv.count is 10 (number)
```

**Types to specify:**
- `type: 'boolean'` - For flags (--verbose)
- `type: 'number'` - For numeric options (--count 10)
- `type: 'string'` - For text options (--name foo)
- `type: 'array'` - For multiple values (--tag a --tag b)

**What to check:** All options should have explicit `type` unless they're meant to be strings.

### 3. Missing `.demandCommand()`

**Problem:** When using subcommands, yargs doesn't require one by default, allowing users to run the CLI with no action.

**Anti-pattern:**
```javascript
// ❌ Bad: user can run "myapp" with no subcommand
const argv = yargs(hideBin(process.argv))
  .command('deploy', 'Deploy the app')
  .command('build', 'Build the app')
  .parse();

// Running "myapp" alone shows help but exits with code 0 (success)
```

**Correct pattern:**
```javascript
// ✅ Good: require at least one subcommand
const argv = yargs(hideBin(process.argv))
  .command('deploy', 'Deploy the app')
  .command('build', 'Build the app')
  .demandCommand(1, 'You must specify a command')
  .parse();

// Running "myapp" alone now fails with an error
```

**What to check:** CLI tools with subcommands should use `.demandCommand()`.

### 4. Not Setting `.fail()` Handler

**Problem:** Default yargs error output includes stack traces and is hard to customize.

**Anti-pattern:**
```javascript
// ❌ Bad: default error formatting shows stack trace
const argv = yargs(hideBin(process.argv))
  .option('config', { type: 'string', demandOption: true })
  .parse();

// User forgets --config
// Output includes full stack trace (ugly and confusing)
```

**Correct pattern:**
```javascript
// ✅ Good: custom error handler
const argv = yargs(hideBin(process.argv))
  .option('config', { type: 'string', demandOption: true })
  .fail((msg, err, yargs) => {
    if (err) throw err; // Preserve original error
    console.error(`Error: ${msg}`);
    console.error('\nFor help, use --help');
    process.exit(1);
  })
  .parse();
```

**What to check:** Production CLIs should have a custom `.fail()` handler for user-friendly errors.

### 5. Middleware That Mutates `argv` Unsafely

**Problem:** Middleware directly mutates `argv` without proper error handling or validation.

**Anti-pattern:**
```javascript
// ❌ Bad: mutates argv without validation
yargs(hideBin(process.argv))
  .middleware((argv) => {
    argv.config = JSON.parse(fs.readFileSync(argv.configFile));
    // Throws if file doesn't exist or isn't valid JSON
  })
  .command('run', 'Run the app', {}, (argv) => {
    console.log(argv.config);
  });
```

**Correct pattern:**
```javascript
// ✅ Good: validates and handles errors
yargs(hideBin(process.argv))
  .middleware((argv) => {
    if (!argv.configFile) return;
    
    try {
      const content = fs.readFileSync(argv.configFile, 'utf8');
      argv.config = JSON.parse(content);
    } catch (err) {
      throw new Error(`Failed to load config from ${argv.configFile}: ${err.message}`);
    }
  })
  .command('run', 'Run the app', {}, (argv) => {
    console.log(argv.config);
  });
```

**What to check:** Middleware should validate inputs and provide clear error messages.

### 6. Missing `.completion()` Setup

**Problem:** Shell completion isn't configured, reducing CLI usability.

**Correct pattern:**
```javascript
// ✅ Good: shell completion enabled
yargs(hideBin(process.argv))
  .command('deploy', 'Deploy the app')
  .command('build', 'Build the app')
  .completion('completion', 'Generate shell completion script')
  .strict()
  .parse();
```

**Usage:**
```bash
# Bash
eval "$(myapp completion)"

# Zsh
source <(myapp completion)
```

**What to check:** Production CLIs should include `.completion()`.

### 7. Positional Arguments Without Type Validation

**Problem:** Positional arguments aren't validated, leading to runtime errors.

**Anti-pattern:**
```javascript
// ❌ Bad: no validation on positional arg
yargs(hideBin(process.argv))
  .command('deploy <environment>', 'Deploy to environment', {}, (argv) => {
    if (!['dev', 'staging', 'prod'].includes(argv.environment)) {
      throw new Error('Invalid environment');
    }
  });
```

**Correct pattern:**
```javascript
// ✅ Good: validate positional arg in builder
yargs(hideBin(process.argv))
  .command('deploy <environment>', 'Deploy to environment', (yargs) => {
    return yargs.positional('environment', {
      describe: 'Target environment',
      type: 'string',
      choices: ['dev', 'staging', 'prod']
    });
  }, (argv) => {
    // argv.environment is guaranteed to be valid here
  });
```

**What to check:** Positional arguments should be validated in the builder function.

## What to Check During Review

### 1. Core Configuration

**Checklist:**
- [ ] `.strict()` is enabled
- [ ] `.demandCommand()` is set (if using subcommands)
- [ ] `.fail()` handler is set for custom error formatting
- [ ] `.completion()` is enabled

**Pattern to look for:**
```javascript
// ✅ Complete setup
const argv = yargs(hideBin(process.argv))
  .strict()
  .demandCommand(1, 'You must specify a command')
  .fail((msg, err, yargs) => {
    if (err) throw err;
    console.error(`Error: ${msg}`);
    process.exit(1);
  })
  .completion()
  .parse();
```

### 2. Option Type Declarations

**Check that:**
- [ ] All options have explicit `type` specified
- [ ] Numeric options use `type: 'number'`
- [ ] Boolean flags use `type: 'boolean'`
- [ ] Array options use `type: 'array'`

**Examples:**
```javascript
// ✅ Good: explicit types
.option('port', { type: 'number', default: 3000 })
.option('verbose', { type: 'boolean', default: false })
.option('tags', { type: 'array', default: [] })
.option('name', { type: 'string' })

// ❌ Bad: no type (will be string)
.option('port', { default: 3000 })  // "3000" not 3000!
```

### 3. Required Options and Validation

**Check for:**
- [ ] Required options use `.demandOption()`
- [ ] Mutually exclusive options use `.conflicts()`
- [ ] Dependent options use `.implies()`
- [ ] Limited valid values use `choices`

**Examples:**
```javascript
// Required option
.option('config', { type: 'string', demandOption: true })

// Mutually exclusive
.option('token', { type: 'string' })
.option('username', { type: 'string' })
.conflicts('token', 'username')

// Dependent options
.option('username', { type: 'string' })
.option('password', { type: 'string' })
.implies('username', 'password')

// Limited values
.option('format', { type: 'string', choices: ['json', 'yaml', 'xml'] })
```

### 4. Command Structure

**Check that:**
- [ ] Commands use the builder pattern
- [ ] Positional arguments are properly typed
- [ ] Handler functions have proper error handling

**Builder pattern:**
```javascript
// ✅ Good: uses builder
.command(
  'deploy <environment>',
  'Deploy to environment',
  (yargs) => {
    return yargs
      .positional('environment', {
        describe: 'Target environment',
        type: 'string',
        choices: ['dev', 'staging', 'prod']
      })
      .option('version', {
        type: 'string',
        default: 'latest'
      });
  },
  async (argv) => {
    try {
      await deploy(argv.environment, argv.version);
    } catch (err) {
      console.error(`Deployment failed: ${err.message}`);
      process.exit(1);
    }
  }
)
```

### 5. Help Text Quality

**Check for:**
- [ ] Commands have descriptions
- [ ] Options have `describe` field
- [ ] Examples are provided with `.example()`
- [ ] `.wrap()` is used for proper terminal width

**Example:**
```javascript
yargs(hideBin(process.argv))
  .command('deploy <env>', 'Deploy the application', (yargs) => {
    return yargs.positional('env', {
      describe: 'Target environment (dev, staging, prod)',
      type: 'string'
    });
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    describe: 'Run with verbose logging'
  })
  .example('$0 deploy prod', 'Deploy to production')
  .example('$0 deploy staging --verbose', 'Deploy to staging with logs')
  .wrap(yargs.terminalWidth())
  .parse();
```

### 6. Middleware Usage

**Check that middleware:**
- [ ] Validates inputs before mutation
- [ ] Provides clear error messages
- [ ] Doesn't throw raw errors (wraps them)
- [ ] Is only used when necessary (don't overuse)

**Good middleware example:**
```javascript
.middleware((argv) => {
  if (argv.configFile) {
    if (!fs.existsSync(argv.configFile)) {
      throw new Error(`Config file not found: ${argv.configFile}`);
    }
    try {
      argv.config = JSON.parse(fs.readFileSync(argv.configFile, 'utf8'));
    } catch (err) {
      throw new Error(`Invalid JSON in config file: ${err.message}`);
    }
  }
})
```

### 7. Async Handler Support

**Check that:**
- [ ] Async handlers use proper error handling
- [ ] Errors are caught and formatted
- [ ] Exit codes are set appropriately

**Pattern:**
```javascript
.command('build', 'Build the project', {}, async (argv) => {
  try {
    await build(argv);
    console.log('Build successful');
  } catch (err) {
    console.error(`Build failed: ${err.message}`);
    process.exit(1);
  }
})
```

## Builder Pattern Best Practices

### Command Definition Structure

**Good structure:**
```javascript
.command(
  'commandName <required> [optional]',  // Command signature
  'Command description',                // Short description
  (yargs) => {                         // Builder function
    return yargs
      .positional('required', {
        describe: 'Required argument',
        type: 'string'
      })
      .positional('optional', {
        describe: 'Optional argument',
        type: 'string',
        default: 'default-value'
      })
      .option('flag', {
        type: 'boolean',
        describe: 'Flag description'
      });
  },
  (argv) => {                          // Handler function
    // Implementation
  }
)
```

### Positional Arguments

**Syntax:**
- `<required>` - Required positional argument
- `[optional]` - Optional positional argument
- `[variadic..]` - Variadic (array) argument

**Example:**
```javascript
.command(
  'merge <source> <target> [files..]',
  'Merge files from source to target',
  (yargs) => {
    return yargs
      .positional('source', {
        describe: 'Source directory',
        type: 'string'
      })
      .positional('target', {
        describe: 'Target directory',
        type: 'string'
      })
      .positional('files', {
        describe: 'Specific files to merge',
        type: 'string',
        array: true
      });
  },
  (argv) => {
    merge(argv.source, argv.target, argv.files);
  }
)
```

## Type Coercion Pitfalls

### Common Gotchas

**Numbers:**
```javascript
// ❌ Without type: "10" (string)
.option('count')

// ✅ With type: 10 (number)
.option('count', { type: 'number' })
```

**Booleans:**
```javascript
// ❌ Without type: "true" (string) or undefined
.option('verbose')

// ✅ With type: true or false
.option('verbose', { type: 'boolean' })
```

**Arrays:**
```javascript
// ❌ Without array type: last value only
// --tag a --tag b → argv.tag = "b"
.option('tag')

// ✅ With array type: all values
// --tag a --tag b → argv.tag = ["a", "b"]
.option('tag', { type: 'array' })
```

### Coerce Function

**For custom transformations:**
```javascript
.option('date', {
  type: 'string',
  coerce: (arg) => {
    const date = new Date(arg);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${arg}`);
    }
    return date;
  }
})
```

## Error Handling Patterns

### Custom Fail Handler

**Recommended pattern:**
```javascript
yargs(hideBin(process.argv))
  .fail((msg, err, yargs) => {
    if (err) {
      // Preserve original error (don't swallow it)
      throw err;
    }
    
    // Custom formatting for yargs validation errors
    console.error('Error:', msg);
    console.error();
    console.error('For help, run with --help');
    process.exit(1);
  })
  .parse();
```

### Async Error Handling

**Pattern:**
```javascript
.command('async-cmd', 'Async command', {}, async (argv) => {
  try {
    await asyncOperation();
  } catch (err) {
    console.error(`Operation failed: ${err.message}`);
    if (argv.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }
})
```

## Testing Yargs CLIs

### Testable Structure

**Pattern:**
```javascript
// cli.js
export function createCLI() {
  return yargs(hideBin(process.argv))
    .command('greet <name>', 'Greet someone', {}, (argv) => {
      console.log(`Hello, ${argv.name}!`);
    })
    .strict()
    .parse();
}

// For production
if (import.meta.url === `file://${process.argv[1]}`) {
  createCLI();
}
```

**Test:**
```javascript
import { createCLI } from './cli.js';

test('greet command', () => {
  const output = [];
  const mockLog = (msg) => output.push(msg);
  console.log = mockLog;
  
  process.argv = ['node', 'cli.js', 'greet', 'World'];
  createCLI();
  
  expect(output).toContain('Hello, World!');
});
```

### Testing with `.exitProcess(false)`

**For preventing actual exit:**
```javascript
export function createCLI(argv = hideBin(process.argv)) {
  return yargs(argv)
    .exitProcess(false)  // Don't call process.exit()
    .command('test', 'Test command', {}, () => {
      console.log('test ran');
    })
    .strict()
    .parse();
}
```

## Review Checklist

**For every yargs PR:**

1. **Core setup:**
   - [ ] `.strict()` is enabled
   - [ ] `.demandCommand()` if using subcommands
   - [ ] Custom `.fail()` handler
   - [ ] `.completion()` for shell completion

2. **Type safety:**
   - [ ] All options have explicit `type`
   - [ ] Numeric options use `type: 'number'`
   - [ ] Boolean flags use `type: 'boolean'`
   - [ ] Array options use `type: 'array'`

3. **Validation:**
   - [ ] Required options use `.demandOption()`
   - [ ] Conflicts use `.conflicts()`
   - [ ] Implications use `.implies()`
   - [ ] Limited values use `choices`

4. **Commands:**
   - [ ] Use builder pattern
   - [ ] Positional args are properly typed
   - [ ] Handlers have error handling

5. **Help text:**
   - [ ] Commands have descriptions
   - [ ] Options have `describe`
   - [ ] Examples with `.example()`
   - [ ] `.wrap(yargs.terminalWidth())`

6. **Error handling:**
   - [ ] Custom `.fail()` handler
   - [ ] Async handlers catch errors
   - [ ] Exit codes set appropriately

## Resources

- [Yargs documentation](https://yargs.js.org/)
- [Yargs API reference](https://yargs.js.org/docs/)
- [Command builder pattern](https://github.com/yargs/yargs/blob/main/docs/advanced.md#providing-a-command-module)
