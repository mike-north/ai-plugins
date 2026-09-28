Saved the review here:

- [.work/credential-rotation-spec-review.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c07/none/repeat-1/workspace/.work/credential-rotation-spec-review.md)
- [.work/index.md](<home>/Projects/Dev%20Platform/Technical%20Leadership/scratch/design-specification-plugin/scratch/effectiveness/pilot-02/runs/c07/none/repeat-1/workspace/.work/index.md)

Key finding: the collection simultaneously preserves credential identity/grants for D2 general release and keeps a D1 contract/example where rotation returns `id=c2` and invalidates `c1`/`g1`. The affected normative example is `docs/examples.md:2`; the passing test report aligns with D2, not the contract or example.

I did not modify code or specs, did not use external services, and did not run tests beyond reading the supplied report.