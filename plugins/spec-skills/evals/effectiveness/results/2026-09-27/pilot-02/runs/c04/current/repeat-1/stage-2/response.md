Done. I reconciled the stale D1-only checkpoint with the current accepted intent in `docs/decisions.md`.

Updated:
- [docs/examples.md](<evaluation-repository>/scratch/effectiveness/pilot-02/runs/c04/current/repeat-1/workspace/docs/examples.md:1): now covers v2 local `09:00` office scheduling by IANA timezone, DST offset behavior, multiple offices, repeated/nonexistent local times from D2, and legacy v1 fixed-UTC behavior.
- [.work/office-times.md](<evaluation-repository>/scratch/effectiveness/pilot-02/runs/c04/current/repeat-1/workspace/.work/office-times.md:1): checkpoint updated with recovered sources, result, and remaining deferred display/request-surface examples.

Verification:
- Checked the updated docs directly.
- Used local Node `Intl` timezone formatting to confirm the UTC examples resolve to the intended local wall times.
- `git diff` had no output because the fixture files are untracked in this checkout, not because the files were unchanged.