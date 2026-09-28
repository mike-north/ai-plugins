Done. I reconciled the office scheduling examples with the accepted D2 decision.

Updated:
- [docs/examples.md](<evaluation-repository>/scratch/effectiveness/pilot-02/runs/c04/none/repeat-1/workspace/docs/examples.md): now documents v2 local 09:00 office-time behavior, timezone storage, regional UTC differences, DST offset changes, repeated/nonexistent local-time policy, and preserved legacy v1 fixed-UTC behavior.
- [.work/office-times.md](<evaluation-repository>/scratch/effectiveness/pilot-02/runs/c04/none/repeat-1/workspace/.work/office-times.md): updated the checkpoint to reflect the resumed work and completion status.

Verification: used local Python `zoneinfo` to confirm the UTC instants for New York and London examples, including the 2026 DST transition. No software test suite was present for these documentation-only changes.