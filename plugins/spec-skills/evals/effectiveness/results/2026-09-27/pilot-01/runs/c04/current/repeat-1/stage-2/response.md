Updated the office scheduling examples and checkpoint.

Changed:
- [docs/examples.md](<evaluation-repository>/scratch/effectiveness/pilot-01/runs/c04/current/repeat-1/workspace/docs/examples.md): reconciled examples with accepted D2 intent for v2 local `09:00` office scheduling, including DST offset behavior, repeated local time, nonexistent local time, and preserved legacy D1 fixed-UTC behavior.
- [.work/office-times.md](<evaluation-repository>/scratch/effectiveness/pilot-01/runs/c04/current/repeat-1/workspace/.work/office-times.md): replaced the stale “three UTC examples” checkpoint with the current reconciled state.

Checks:
- Confirmed the edited files are present and non-empty.
- Confirmed stale headings/phrases like `Examples In Progress`, `Deferred Examples`, and the old D1-only framing no longer remain.
- Round-tripped the listed UTC instants to `America/Los_Angeles` wall times with local Node `Intl` checks.