# Cobra CLI Review Guidance

## Overview

Cobra is a Go library for creating powerful modern CLI applications. It's used by many popular projects including kubectl, Hugo, and GitHub CLI. Cobra provides command structure, flag parsing, help generation, and shell completion.

**Core concepts:**
- Commands form a tree (root command + subcommands)
- Flags can be persistent (inherited by subcommands) or local
- `Run` vs `RunE`: `RunE` allows returning errors
- Help and usage text are auto-generated from struct fields

## Common Mistakes

### 1. Using `Run` Instead of `RunE`

**Problem:** `Run` doesn't return errors, forcing awkward error handling with `os.Exit` or panics.

**Anti-pattern:**
```go
// ❌ Bad: can't return errors
var rootCmd = &cobra.Command{
  Use: "myapp",
  Run: func(cmd *cobra.Command, args []string) {
    if err := doSomething(); err != nil {
      fmt.Fprintf(os.Stderr, "Error: %v\n", err)
      os.Exit(1)  // Hard to test, bypasses defer cleanup
    }
  },
}
```

**Correct pattern:**
```go
// ✅ Good: returns errors
var rootCmd = &cobra.Command{
  Use: "myapp",
  RunE: func(cmd *cobra.Command, args []string) error {
    return doSomething()  // Errors propagate naturally
  },
}
```

**Why it matters:**
- `RunE` errors propagate to `Execute()`, which returns them
- Enables proper testing without `os.Exit`
- Allows cleanup with `defer`

### 2. Not Setting `SilenceUsage` and `SilenceErrors`

**Problem:** Cobra prints usage and errors by default, causing duplicate error messages when you also print errors in `main()`.

**Anti-pattern:**
```go
func main() {
  if err := rootCmd.Execute(); err != nil {
    fmt.Fprintf(os.Stderr, "Error: %v\n", err)  // Cobra already printed this
    os.Exit(1)
  }
}
```

**Result:** Error appears twice in output.

**Correct pattern:**
```go
var rootCmd = &cobra.Command{
  Use:           "myapp",
  SilenceUsage:  true,  // Don't print usage on error
  SilenceErrors: true,  // Don't print errors (we'll handle in main)
  RunE: func(cmd *cobra.Command, args []string) error {
    return doSomething()
  },
}

func main() {
  if err := rootCmd.Execute(); err != nil {
    fmt.Fprintf(os.Stderr, "Error: %v\n", err)
    os.Exit(1)
  }
}
```

### 3. Persistent Flags That Should Be Local (or Vice Versa)

**Problem:** Flags are incorrectly scoped, appearing on subcommands where they don't make sense.

**Persistent flag (inherited by all subcommands):**
```go
// ✅ Good: --verbose makes sense everywhere
rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")
```

**Local flag (only on specific command):**
```go
// ✅ Good: --output only makes sense for this command
serveCmd.Flags().StringVarP(&outputFormat, "output", "o", "json", "output format")
```

**Anti-pattern:**
```go
// ❌ Bad: --output appears on all subcommands even if they don't use it
rootCmd.PersistentFlags().StringVarP(&outputFormat, "output", "o", "json", "output format")
```

**What to check:**
- Is this flag relevant to all subcommands? → Persistent
- Is this flag only relevant to one command? → Local

### 4. Not Validating Flag Combinations

**Problem:** Mutually exclusive flags or required-together flags aren't validated.

**Anti-patterns:**
```go
// ❌ Bad: no validation for mutually exclusive flags
cmd.Flags().StringVar(&configFile, "config", "", "config file")
cmd.Flags().StringVar(&configURL, "config-url", "", "config URL")
// User can pass both, causing confusion
```

**Correct patterns:**
```go
// ✅ Good: validate mutually exclusive flags
cmd.MarkFlagsMutuallyExclusive("config", "config-url")

// ✅ Good: validate required-together flags
cmd.MarkFlagsRequiredTogether("username", "password")

// ✅ Good: validate one of flags is required
cmd.MarkFlagsOneRequired("config", "config-url")
```

**Custom validation in `PreRunE`:**
```go
cmd.PreRunE = func(cmd *cobra.Command, args []string) error {
  if configFile != "" && configURL != "" {
    return errors.New("cannot specify both --config and --config-url")
  }
  return nil
}
```

### 5. Hardcoding `os.Exit` Instead of Returning Errors

**Problem:** Direct `os.Exit` calls bypass defer cleanup and make testing impossible.

**Anti-pattern:**
```go
// ❌ Bad: can't test, breaks cleanup
RunE: func(cmd *cobra.Command, args []string) error {
  if !validate(args[0]) {
    fmt.Fprintln(os.Stderr, "invalid input")
    os.Exit(1)  // Bad!
  }
  return nil
}
```

**Correct pattern:**
```go
// ✅ Good: return error instead
RunE: func(cmd *cobra.Command, args []string) error {
  if !validate(args[0]) {
    return errors.New("invalid input")
  }
  return nil
}
```

### 6. Missing `Args` Validation

**Problem:** Commands don't validate the number or format of positional arguments.

**Anti-pattern:**
```go
// ❌ Bad: no validation, will panic if no args
RunE: func(cmd *cobra.Command, args []string) error {
  name := args[0]  // Panic if no args!
  return process(name)
}
```

**Correct patterns:**
```go
// ✅ Good: require exactly 1 argument
var cmd = &cobra.Command{
  Use:  "greet <name>",
  Args: cobra.ExactArgs(1),
  RunE: func(cmd *cobra.Command, args []string) error {
    return greet(args[0])
  },
}

// ✅ Good: require at least 2 arguments
var cmd = &cobra.Command{
  Use:  "merge <file1> <file2> [files...]",
  Args: cobra.MinimumNArgs(2),
  RunE: func(cmd *cobra.Command, args []string) error {
    return merge(args...)
  },
}

// ✅ Good: custom validation
var cmd = &cobra.Command{
  Use:  "connect <url>",
  Args: func(cmd *cobra.Command, args []string) error {
    if len(args) != 1 {
      return errors.New("requires exactly one URL argument")
    }
    if !isValidURL(args[0]) {
      return fmt.Errorf("invalid URL: %s", args[0])
    }
    return nil
  },
}
```

**Built-in validators:**
- `cobra.NoArgs` - No arguments allowed
- `cobra.ExactArgs(n)` - Exactly n arguments
- `cobra.MinimumNArgs(n)` - At least n arguments
- `cobra.MaximumNArgs(n)` - At most n arguments
- `cobra.RangeArgs(min, max)` - Between min and max arguments

### 7. Missing Completion Setup

**Problem:** Shell completion isn't configured, reducing CLI usability.

**What to check:**
```go
// ✅ Good: completion command is set up
func init() {
  rootCmd.AddCommand(completionCmd)
}

var completionCmd = &cobra.Command{
  Use:   "completion [bash|zsh|fish|powershell]",
  Short: "Generate completion script",
  Long: `To load completions:

Bash:
  $ source <(myapp completion bash)

Zsh:
  $ myapp completion zsh > "${fpath[1]}/_myapp"

Fish:
  $ myapp completion fish | source

PowerShell:
  PS> myapp completion powershell | Out-String | Invoke-Expression
`,
  DisableFlagsInUseLine: true,
  ValidArgs:             []string{"bash", "zsh", "fish", "powershell"},
  Args:                  cobra.ExactValidArgs(1),
  Run: func(cmd *cobra.Command, args []string) {
    switch args[0] {
    case "bash":
      cmd.Root().GenBashCompletion(os.Stdout)
    case "zsh":
      cmd.Root().GenZshCompletion(os.Stdout)
    case "fish":
      cmd.Root().GenFishCompletion(os.Stdout, true)
    case "powershell":
      cmd.Root().GenPowerShellCompletionWithDesc(os.Stdout)
    }
  },
}
```

**Dynamic completion:**
```go
// ✅ Good: dynamic completion for flag values
cmd.RegisterFlagCompletionFunc("format", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
  return []string{"json", "yaml", "xml"}, cobra.ShellCompDirectiveNoFileComp
})

// ✅ Good: dynamic completion for arguments
cmd.ValidArgsFunction = func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
  return getAvailableProjects(), cobra.ShellCompDirectiveNoFileComp
}
```

### 8. Help Text Without Examples

**Problem:** Help text doesn't show realistic usage examples.

**Anti-pattern:**
```go
// ❌ Bad: no examples
var cmd = &cobra.Command{
  Use:   "deploy",
  Short: "Deploy the application",
}
```

**Correct pattern:**
```go
// ✅ Good: includes examples
var cmd = &cobra.Command{
  Use:   "deploy",
  Short: "Deploy the application",
  Long: `Deploy the application to the specified environment.

The deploy command builds, packages, and uploads your application
to the target environment.`,
  Example: `  # Deploy to production
  myapp deploy --env production

  # Deploy specific version
  myapp deploy --env staging --version v1.2.3

  # Deploy with custom config
  myapp deploy --env dev --config config.yaml`,
}
```

## What to Check During Review

### 1. Error Handling Pattern

**Checklist:**
- [ ] All commands use `RunE` instead of `Run`
- [ ] No `os.Exit()` calls in command handlers
- [ ] Errors are returned, not printed directly
- [ ] Root command has `SilenceUsage: true` and `SilenceErrors: true`

**Pattern to look for:**
```go
// ✅ Correct pattern
var rootCmd = &cobra.Command{
  Use:           "myapp",
  SilenceUsage:  true,
  SilenceErrors: true,
}

func main() {
  if err := rootCmd.Execute(); err != nil {
    fmt.Fprintf(os.Stderr, "Error: %v\n", err)
    os.Exit(1)
  }
}
```

### 2. Flag Scoping

**Questions to ask:**
- [ ] Are global flags (verbose, config, etc.) set as `PersistentFlags`?
- [ ] Are command-specific flags set as `Flags` (local)?
- [ ] Do flags appear only where they're relevant?

**Check the flag registration:**
```go
// Global flags on root command
rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")
rootCmd.PersistentFlags().StringVar(&configFile, "config", "", "config file")

// Local flags on specific commands
deployCmd.Flags().StringVar(&environment, "env", "dev", "deployment environment")
```

### 3. Flag Validation

**Check for:**
- [ ] Mutually exclusive flags use `MarkFlagsMutuallyExclusive`
- [ ] Required-together flags use `MarkFlagsRequiredTogether`
- [ ] At-least-one-required flags use `MarkFlagsOneRequired`
- [ ] Complex validation logic in `PreRunE`

**Example:**
```go
cmd.Flags().String("token", "", "auth token")
cmd.Flags().String("username", "", "username")
cmd.Flags().String("password", "", "password")

cmd.MarkFlagsMutuallyExclusive("token", "username")
cmd.MarkFlagsRequiredTogether("username", "password")
cmd.MarkFlagsOneRequired("token", "username")
```

### 4. Argument Validation

**Check for:**
- [ ] Commands have `Args` set appropriately
- [ ] Positional arguments are documented in `Use` field
- [ ] Custom validators check argument format/validity

**Use field should show argument names:**
```go
// ✅ Good: arguments are clear
Use: "deploy <environment> [version]"
Args: cobra.RangeArgs(1, 2),

// ❌ Bad: arguments not shown
Use: "deploy"
Args: cobra.RangeArgs(1, 2),
```

### 5. Help Text Quality

**Checklist:**
- [ ] `Short` is a single-line description
- [ ] `Long` provides detailed explanation (if needed)
- [ ] `Example` shows realistic usage patterns
- [ ] `Use` field shows the correct syntax with arguments
- [ ] Flags have descriptive help text

**Good help text example:**
```go
var deployCmd = &cobra.Command{
  Use:   "deploy <environment>",
  Short: "Deploy the application to an environment",
  Long: `Deploy the application to the specified environment.

This command will:
  1. Build the application
  2. Package it for deployment
  3. Upload it to the target environment
  4. Restart the application`,
  Example: `  # Deploy to production
  myapp deploy production

  # Deploy with custom config
  myapp deploy staging --config staging.yaml`,
  Args: cobra.ExactArgs(1),
}
```

### 6. Command Tree Structure

**Check that:**
- [ ] Subcommands are logically grouped
- [ ] Command depth is reasonable (≤3 levels typically)
- [ ] Related commands share a common parent

**Good structure:**
```
myapp
├── deploy <env>        # Top-level action
├── config              # Grouped config commands
│   ├── set <key> <value>
│   ├── get <key>
│   └── list
└── logs                # Grouped log commands
    ├── tail
    └── download
```

**Anti-pattern (too flat):**
```
myapp
├── deploy
├── config-set
├── config-get
├── config-list         # Should be subcommands of 'config'
├── logs-tail
└── logs-download       # Should be subcommands of 'logs'
```

### 7. Completion Implementation

**Check for:**
- [ ] `completion` command exists
- [ ] Supports multiple shells (bash, zsh, fish, powershell)
- [ ] Dynamic completions for flags with limited valid values
- [ ] `ValidArgsFunction` for dynamic argument completion

**Example flag completion:**
```go
cmd.Flags().String("format", "json", "output format")
cmd.RegisterFlagCompletionFunc("format", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
  return []string{"json", "yaml", "xml", "table"}, cobra.ShellCompDirectiveNoFileComp
})
```

## Flag Conventions

### Naming Conventions

**Follow these patterns:**
- Use kebab-case for multi-word flags: `--config-file`, not `--configFile` or `--config_file`
- Single-char shortcuts for common flags: `-v` for `--verbose`, `-f` for `--force`
- Boolean flags should be positive: `--verbose`, not `--no-verbose` (use negation variants only if needed)

**Examples:**
```go
// ✅ Good
cmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")
cmd.Flags().StringVarP(&output, "output", "o", "", "output file")
cmd.Flags().IntVarP(&count, "max-count", "n", 10, "maximum count")

// ❌ Bad
cmd.Flags().BoolVar(&verbose, "Verbose", false, "verbose output")  // Capital V
cmd.Flags().StringVar(&output, "output_file", "", "output file")    // Underscore
```

### Common Flag Patterns

**Global flags (on root command as persistent):**
- `--verbose, -v` - Verbose output
- `--config, -c` - Config file path
- `--output, -o` - Output file/format
- `--help, -h` - Show help (automatic)
- `--version` - Show version (if using `rootCmd.Version`)

**Action-specific flags:**
- `--force, -f` - Force operation, skip confirmations
- `--dry-run` - Preview without executing
- `--yes, -y` - Auto-confirm prompts

## Error Handling Best Practices

### Returning Errors from Commands

**Pattern:**
```go
var cmd = &cobra.Command{
  Use: "process <file>",
  Args: cobra.ExactArgs(1),
  RunE: func(cmd *cobra.Command, args []string) error {
    file := args[0]
    
    // Validate input
    if !fileExists(file) {
      return fmt.Errorf("file not found: %s", file)
    }
    
    // Do work
    if err := processFile(file); err != nil {
      return fmt.Errorf("failed to process file: %w", err)
    }
    
    return nil
  },
}
```

### Main Function Pattern

**Standard pattern:**
```go
func main() {
  if err := rootCmd.Execute(); err != nil {
    fmt.Fprintf(os.Stderr, "Error: %v\n", err)
    os.Exit(1)
  }
}
```

**With custom exit codes:**
```go
func main() {
  if err := rootCmd.Execute(); err != nil {
    fmt.Fprintf(os.Stderr, "Error: %v\n", err)
    
    // Custom exit codes based on error type
    var exitCode int
    switch {
    case errors.Is(err, ErrInvalidInput):
      exitCode = 2
    case errors.Is(err, ErrNotFound):
      exitCode = 3
    default:
      exitCode = 1
    }
    
    os.Exit(exitCode)
  }
}
```

## Testing Cobra Commands

### Testable Command Structure

**Pattern:**
```go
// Command struct holds flags and state
type DeployCmd struct {
  environment string
  version     string
}

func (c *DeployCmd) RunE(cmd *cobra.Command, args []string) error {
  // Implementation here - easily testable
  return c.deploy()
}

func (c *DeployCmd) deploy() error {
  // Business logic - can be tested without Cobra
  return nil
}

// Cobra command setup
func NewDeployCmd() *cobra.Command {
  c := &DeployCmd{}
  cmd := &cobra.Command{
    Use:  "deploy",
    RunE: c.RunE,
  }
  cmd.Flags().StringVar(&c.environment, "env", "dev", "environment")
  cmd.Flags().StringVar(&c.version, "version", "latest", "version")
  return cmd
}
```

**Test:**
```go
func TestDeployCmd(t *testing.T) {
  cmd := NewDeployCmd()
  cmd.SetArgs([]string{"--env", "prod", "--version", "v1.2.3"})
  
  err := cmd.Execute()
  if err != nil {
    t.Fatalf("expected no error, got %v", err)
  }
}
```

## Review Checklist

**For every Cobra command PR:**

1. **Error handling:**
   - [ ] Uses `RunE` instead of `Run`
   - [ ] No `os.Exit()` in command handlers
   - [ ] Root command has `SilenceUsage` and `SilenceErrors`

2. **Flag scoping:**
   - [ ] Global flags are persistent
   - [ ] Command-specific flags are local
   - [ ] Flag names follow kebab-case convention

3. **Validation:**
   - [ ] `Args` validator is set appropriately
   - [ ] Mutually exclusive flags are marked
   - [ ] Required-together flags are marked
   - [ ] Custom validation in `PreRunE` if needed

4. **Help text:**
   - [ ] `Short` description is present
   - [ ] `Long` description for complex commands
   - [ ] `Example` shows realistic usage
   - [ ] `Use` field shows argument syntax

5. **Completion:**
   - [ ] `completion` command exists
   - [ ] Dynamic completions for enum-like flags
   - [ ] `ValidArgsFunction` for dynamic args

6. **Structure:**
   - [ ] Commands are logically grouped
   - [ ] Command depth is reasonable
   - [ ] No unnecessary nesting

## Resources

- [Cobra documentation](https://github.com/spf13/cobra)
- [Cobra User Guide](https://github.com/spf13/cobra/blob/master/user_guide.md)
- [Shell completions](https://github.com/spf13/cobra/blob/master/shell_completions.md)
