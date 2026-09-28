Saved the candidate collapse and decision record.

Changed/created:
- [docs/installation-organizing-candidate.md](<evaluation-repository>/scratch/effectiveness/pilot-03/runs/c01/none/repeat-1/workspace/docs/installation-organizing-candidate.md): proposes `Product` + `Use`, tests it against tile, schedule, webhook, publishing, multiple configs, and marketplace approval.
- [docs/index.md](<evaluation-repository>/scratch/effectiveness/pilot-03/runs/c01/none/repeat-1/workspace/docs/index.md): adds the new doc to the reading map.
- [.work/installation-organizing-candidate.md](<evaluation-repository>/scratch/effectiveness/pilot-03/runs/c01/none/repeat-1/workspace/.work/installation-organizing-candidate.md): checkpoint with the candidate and decision needed.
- [.work/index.md](<evaluation-repository>/scratch/effectiveness/pilot-03/runs/c01/none/repeat-1/workspace/.work/index.md): links the checkpoint.

The decision recorded is: accept or reject collapsing `TileInstallation`, `ScheduleInstallation`, and `WebhookInstallation` into one customer-side `Use` concept, where tile, schedule, and webhook are contexts. I kept it explicitly marked as not accepted and avoided API design. Verification was a local read-through plus a grep for API-shaping terms; only the explicit “not an API pass” guardrail matched.