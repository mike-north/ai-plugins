# Authoring a sub-agent (delegate + read fresh)

An agent is a **sub-task actor with its own context window and tool set**. Reach for it on five
co-equal tells: **context isolation · parallelism · a distinct role/expertise · cheaper-tier offload ·
tool-scoping/containment**. It's the most expensive primitive — don't use it where a script + one tool
call suffices.

## Delegate

Use **`plugin-dev:agent-development`** when available (frontmatter, the "when to use" description,
tool grants, examples). For Claude Code specifics, WebFetch `https://code.claude.com/docs/en/sub-agents.md`
fresh. In this marketplace's plugin format, agents are `.md` files under `agents/`.

## Set the two efficiency levers deliberately

- **Model tier (Axis 2).** Pin the **cheapest tier** that does the job. Offloading a menial/high-token
  task to a cheap, disposable subagent protects the orchestrator's context *and* cost. Elevate the
  tier only for a genuinely hard sub-problem.
- **Tool-scoping (containment).** Grant only the tools the agent needs. A powerful pattern: **forbid a
  heavy/expensive tool in the orchestrator** and **allow it only here**, so a large payload flows
  through a disposable context and never pollutes the main thread.

## Apply determinism first

Before the agent reasons, push as much as possible into deterministic queries/scripts (e.g. aggregate
in the database, extract with a script). The agent should handle only the **irreducible** judgment.
