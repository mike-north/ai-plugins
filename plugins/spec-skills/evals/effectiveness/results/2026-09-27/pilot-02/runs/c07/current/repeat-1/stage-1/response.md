Saved the review at [docs/credential-rotation-review.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c07/current/repeat-1/workspace/docs/credential-rotation-review.md:1) and linked it from [docs/index.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c07/current/repeat-1/workspace/docs/index.md:4).

Concrete findings captured:
- D2/domain/tests say rotation preserves credential identity and grants.
- The contract still says D1 is accepted/not superseded and requires a new credential ID plus revoking the original grants.
- The normative general-release example still shows D1 behavior: `c1`/`g1` becomes `id=c2`, with `c1` and `g1` invalid.
- Beta migration is explicitly unchosen, but the contract/example do not isolate D1 as beta-only.

I did not modify code or silently choose a source. I did not independently rerun tests; the review records the supplied passing report as evidence.