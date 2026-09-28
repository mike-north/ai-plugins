Implemented the release model end to end.

Updated [src/registry.py](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/none/repeat-1/workspace/src/registry.py:1) with the small in-memory interface:
`publish(versions, version_id)` adds to the version set, and `adopt(usages, usage_id, version_id, versions)` validates unknown usage/unpublished version before mutating only that usage’s `version`.

Added behavioral tests first in [tests/test_registry.py](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/none/repeat-1/workspace/tests/test_registry.py:1), covering pinned publication, explicit per-usage adoption, local retry preservation, and pre-mutation `ValueError` cases.

Developed the docs:
- [docs/domain.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/none/repeat-1/workspace/docs/domain.md:1)
- [docs/contract.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/none/repeat-1/workspace/docs/contract.md:1)
- [docs/decisions.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/none/repeat-1/workspace/docs/decisions.md:1)
- updated [docs/index.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/none/repeat-1/workspace/docs/index.md:1) and [docs/brief.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c08/none/repeat-1/workspace/docs/brief.md:1)

Verification: `python3 -m unittest discover -s tests` passes, 5 tests OK.