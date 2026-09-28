Done. I updated the release model and contract, then implemented the small Python interface with tests first.

Key changes:
- Accepted shared Usage model and pinned adoption in [docs/domain.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/current/repeat-1/workspace/docs/domain.md:1)
- Added the concrete interface contract, examples, errors, and validation map in [docs/contract.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/current/repeat-1/workspace/docs/contract.md:1)
- Recorded accepted decisions and revision triggers in [docs/decisions.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/current/repeat-1/workspace/docs/decisions.md:3)
- Implemented `publish` and `adopt` in [src/registry.py](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/current/repeat-1/workspace/src/registry.py:10)
- Added behavioral `unittest` coverage in [tests/test_registry.py](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/current/repeat-1/workspace/tests/test_registry.py:20)

Verification: `python3 -m unittest discover -s tests` passes, 4 tests OK.