# Product-led Eng Fleet

Run a product-led engineering fleet over a GitHub-issue work queue.

## Overview

This extension provides a reusable operating model for running software delivery as a fleet
of autonomous coding agents coordinated through GitHub issues:

- The **PM** files self-contained, pickup-ready issues — the only PM→eng interface.
- An **orchestrator** loop triages a deterministically-ranked queue, claims issues, delegates
  to implementer agents, monitors each PR, and merges finished work.
- **Implementers** each take one issue, build against its acceptance criteria, open a PR
  (`Refs #N`), and stop — the orchestrator runs the review cycle.

The queue state is detected by a deterministic engine (`gh-queue`, over `git` and the
GitHub CLI), not by reasoning over issues in context, and every GitHub write goes through a
bounded, allowlistable script (the companion `github-fleet-tools` plugin) rather
than arbitrary `gh api`. Commands: `eng-loop`, `queue`, `file-issue`.
