Done. I stayed inside the workspace and made only local file changes.

I saved the durable domain decision in [docs/domain.md](<evaluation-repository>/scratch/effectiveness/pilot-02/runs/c06/current/repeat-1/workspace/docs/domain.md), clarifying that invoice display labels are mutable human-facing text while invoice identifiers remain stable citation targets. I also updated [docs/index.md](<evaluation-repository>/scratch/effectiveness/pilot-02/runs/c06/current/repeat-1/workspace/docs/index.md) so that decision is discoverable.

I added the resumable local work records in `.work/`:
- [.work/acct-48-campaign-draft.md](<evaluation-repository>/scratch/effectiveness/pilot-02/runs/c06/current/repeat-1/workspace/.work/acct-48-campaign-draft.md): explicitly marked as an unsynchronized draft, not authoritative.
- [.work/acct-48-checkpoint.md](<evaluation-repository>/scratch/effectiveness/pilot-02/runs/c06/current/repeat-1/workspace/.work/acct-48-checkpoint.md): recovery sources, effective preferences, completed local work, pending questions, and resume condition.
- [.work/index.md](<evaluation-repository>/scratch/effectiveness/pilot-02/runs/c06/current/repeat-1/workspace/.work/index.md): now points to both ACCT-48 records.

Campaign report, honestly: `issues.example/ACCT-48` remains the authoritative campaign record, but the configured issue service is unavailable here and no external writes were authorized, so I did not update it. The local campaign draft says implementation and validation are not started in this workspace, and that issue status may be stale. No software was implemented, so I did not run code tests.