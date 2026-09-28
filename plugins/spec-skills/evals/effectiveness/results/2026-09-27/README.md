# Calibration evidence

Read [the interpreted results](../../RESULTS.md) before using these records. Process completion, semantic quality, and human preference are separate facts.

- `coverage.json`: actual completed chain and stage counts, with exploratory and corrected runs separate.
- `stage-metrics.json`: host-reported usage, elapsed time, command counts, and tool attempts.
- `dimension-judgments.json`: individual blinded model judgments, identified by source run and comparison baseline.
- `dimension-summary.json`: per-case, per-variant and per-baseline sample counts and dispersion; N=1 is not variance evidence.
- `capability-trace-audit.json`: zero-tool constraints checked against actual started and completed events, including older metadata without attempt counts.
- `raw-trace-inventory.json`: hashes and sizes for original raw traces retained under ignored `scratch/effectiveness/`.
- `pilot-01/` through `pilot-05/`: original source-hash manifests, versioned task/rubric inputs, anonymous allocation, model grades where available, final responses, before/after artifact states, and command excerpts.

Original private workstation prefixes are replaced with `<evaluation-repository>` and `<home>`. Recorded hashes still refer to the original source and raw trace files. Command output excerpts are bounded to 6,000 characters and explicitly mark truncation; the full-output hash accompanies each excerpt. This evidence export is not a byte-identical copy of every raw event stream.

Anonymous allocation maps grade labels back to the saved actual variant directories. In a copied grade, `A/stage-2/after.json` means the candidate's stage-two artifact snapshot, resolved with that run's allocation. The snapshots preserve real file content, including mistakes; they are not golden expected answers. Frozen guidance/source snapshots and full raw events remain in ignored scratch alongside each run, while the portable record preserves their hashes and substantive output evidence.

The optional swapped-label judgment was not run after automatic approval review rejected the model call. Pilot-05 has direct trace and artifact assessment, not a fabricated independent blind grade. The original exploratory pilot is excluded from corrected-isolation claims. No human feedback has been received.
