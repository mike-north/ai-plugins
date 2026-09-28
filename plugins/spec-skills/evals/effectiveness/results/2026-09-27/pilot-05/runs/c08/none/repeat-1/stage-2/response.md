Done. I updated [docs/domain.md](<evaluation-repository>/scratch/effectiveness/pilot-05/runs/c08/none/repeat-1/workspace/docs/domain.md) and added [docs/contract.md](<evaluation-repository>/scratch/effectiveness/pilot-05/runs/c08/none/repeat-1/workspace/docs/contract.md).

The docs now capture:

- One accepted `Usage` concept for TileInstall and JobInstall this release.
- Pinned version behavior: publish leaves usages unchanged, adopt is explicit per usage.
- Retry configuration remaining local to each usage.
- `publish(versions, version_id)` and `adopt(usages, usage_id, version_id, versions)` contracts.
- `ValueError` before mutation for unknown usage or unpublished version.
- Non-goals: no persistent storage, no execution engine, no product-specific install lifecycles.

I left `src/registry.py` and test files unchanged, and I did not run registry operations or tests.