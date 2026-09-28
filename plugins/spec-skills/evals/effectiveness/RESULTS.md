# Calibration results — 2026-09-27

The new guidance shows useful gains in durable reasoning and discoverable shared records, with mixed overall effectiveness. Capable baselines found the central conceptual models and seeded review defects in these cases. The current guidance also over-selected spec authoring for a trivial anchor edit and expanded one accepted decision into an unapproved neighboring default. These are actionable findings, not a release-wide pass or failure.

The source skills were frozen throughout. No skill was rewritten to fit these results. The [protocol](PROTOCOL.md), [cases](CASES.md), [grading instructions](GRADING.md), and [validation record](VALIDATION.md) distinguish semantic judgments, actual tool evidence, and infrastructure checks. Machine-readable evidence is under [results/2026-09-27](results/2026-09-27/README.md).

## What ran

The corpus contains **36 behavior cases and 24 description-routing cases**, across 67 authored stages. Eight behavior cases and six routing cases were selected for calibration. **46 cases remain reserved and unrun**; their presence in a valid corpus is not execution evidence.

| Experiment | Purpose | Completed chains / stages | Treatment |
| --- | --- | --- | --- |
| pilot-01 | Initial four-case current/no-guidance exploration | 8 / 14 | Retained but excluded from clean-isolation claims: Git commands could discover the parent repository. |
| pilot-02 | Eight behavior cases, current/no-guidance | 16 / 28 | Eight independent blind comparisons; c08 has an authoring-stage boundary ambiguity. |
| pilot-03 | Repeated c01/c05, c02 against prior Deep Design, six routing controls | 18 / 18 | Nine independent blind comparisons. |
| pilot-04 | Three additional anchor-edit routing repetitions per variant | 6 / 6 | Actual route choices inspected directly; no extra quality judge needed. |
| pilot-05 | Corrected four-session design → specification → implementation → audit | 2 / 8 | Only the c08 document-only stage boundary changed; source skills stayed frozen. |

The corrected experiments completed **42 chains and 60 stages**; the excluded exploratory experiment adds eight chains and fourteen stages. A chain is one case, guidance variant and independent repetition. Every stage starts a new CLI session and receives only the retained fixture state, declared contributor changes, and its current task. Corrected fixtures are independent unborn Git repositories; no commits were created. There is no native Copilot, live issue tracker, operating-system symlink-denial or committed-review-revision trial here.

Seventeen corrected blind comparisons have valid grades. One malformed judge answer was retained and retried in a fresh session. A/B allocation is saved separately; method-revealing prose makes blinding imperfect. Human usefulness assessment is pending. An optional swapped-position judge check did not run because automatic approval review rejected sending its evaluation payload to the Codex subprocess/service as a potentially unauthorized disclosure. Further model calls were not used to work around that rejection; the final handoff has direct artifact/trace assessment rather than another blind grade.

## Findings that affect the product

| Case | Observed result | Assessment |
| --- | --- | --- |
| c01, reusable behavior and placements | Both methods found the central model. Current outputs more explicitly preserved the enabling assumption, sacrificed flexibility and conditions that would invalidate the simplification. Current was preferred in both corrected repetitions. | Evidence for the compression explanation and checkpoint work, not proof the baseline could not simplify. |
| c02, shipment eligibility | Current, no-guidance and original Deep Design all retained legitimate derived eligibility and a useful distinction. Current was narrowly preferred for explanations and revision conditions. | A modest documentation gain; the original method did **not** blindly eliminate every discriminator. |
| c03, no specification → acceptance → drift audit | Both recovered accepted pinning intent and found publication incorrectly updating usages. Current's accepted-decision section added that new usages may default to the latest version, beyond the user's acceptance of existing usage pinning and explicit adoption. The blind judge preferred the baseline on scope. | Consequential acceptance leakage. Traceable prose is insufficient if an added obligation lacks authority. |
| c04, stale checkpoint after a contributor decision | Both reconciled accepted local wall-time semantics against the stale UTC checkpoint, preserved prior history, and left the unrelated billing record intact. Blind comparison tied. | Recovery worked in both variants; no demonstrated comparative gain on this case. |
| c05, Markdown-only review | Both variants in both repetitions found the cross-tenant lookup defect, rejected table/class correspondence and future-release false alarms, and acknowledged absent execution/migration proof. All four subjects made zero tool attempts. One slight current preference, one tie. | Similar practical review adequacy. This is a text-only review fixture, not native Copilot validation. |
| c06, project preference and an issue-backed campaign | Both retained the external issue as authority and did not change personal defaults or claim an external update. Current preserved an unrelated naming investigation in `.work/index.md`; baseline rewrote that index and lost its discoverability while leaving the file present. | Concrete continuity benefit. A draft being placed under `docs/` alone is not treated as an authority violation. |
| c07, accepted identity change and stale contracts | Both identified the contradiction among the accepted identity decision, contract and examples, avoided treating tests as authority, and left migration questions open. Current saved an indexed shared review; baseline saved only a private `.work/` review despite the repository's shared-review rule. | Concrete persistence and review-discoverability benefit; both did the substantive contradiction analysis. |
| c08 v1, complete journey | Both variants wrote and tested code during the nominal specification stage, then revalidated it in implementation. Current received the stronger blind traceability judgment. | The prompt did not isolate authoring from implementation strongly enough. This run cannot establish a clean authoring-to-implementer handoff. |
| c08 v2, explicit document-only stage | Both variants retained the original source stub and created no tests during stage two. Both fresh implementers followed tests-first development and both final reviewers preserved code and saved shared reviews. Current synchronized the accepted decision record; baseline left its earlier proposal stale and its reviewer caught that inconsistency. | Corrected boundary evidence, with an evaluation-input change explicitly recorded. |
| t17, anchor-only Markdown maintenance | Current selected spec-authoring in **4/4** fresh routing trials; prior selected it in **1/4**. | A repeated negative-control failure in the description-selection proxy. These small counts are not estimates of native activation rates. |

The c03 blind grade also objected to retaining a historical checkpoint marked superseded; preserving clearly labeled history is not itself an authority error. Its suspicion of a Git-state claim was also weaker than the directly observed scope expansion. These adjudications are retained rather than treating all model criticism as fact. Likewise, routing preferences based chiefly on brevity or the prior bundle lacking a newly introduced skill do not establish meaningful routing superiority.

## Final handoff trace assessment

Both complete four-stage chains finished. The [direct trace assessment](results/2026-09-27/pilot-05/direct-trace-assessment.json) verifies unchanged source stubs and no test files after stage two. In stage three, both subjects wrote four outcome tests, ran them against the original stubs and observed four `NotImplementedError` failures, then implemented publication/adoption and observed all four tests passing. Both recovered from an unavailable `python` alias by using `python3`; neither confused that environment error with the expected test failure.

Both fresh stage-four reviewers ran passing tests, left implementation and test files unchanged, and saved `docs/review.md`. Current preserved synchronized accepted decisions. Baseline's authoring stage left `docs/decisions.md` marked “Proposed, not accepted”; its final review correctly called out that documentation contradiction while finding the implementation aligned. This is a visible continuity difference, not evidence that baseline implementation failed.

The earlier v1 outputs remain intact. No blind comparative score is assigned to v2; these are directly inspectable artifact and command facts, with evaluator interpretation explicitly distinguished from independent grading.

## Effort, repetitions and uncertainty

The [stage metrics](results/2026-09-27/stage-metrics.json) retain actual duration, host-reported usage, command counts and tool attempts. Input-token totals include repeated context and cache reporting; they are not unique source tokens or a price estimate. Missing data stays unknown.

For corrected c01, current took about **98 and 93 seconds** versus **62 and 72 seconds** with no supplied guidance. The three-stage c03 totals were approximately **374 versus 238 seconds**. The two-stage c04 totals were **181 versus 140 seconds**. The c05 text-only reviews took roughly **15 and 16 seconds** versus **10 and 12 seconds**. Longer work was not automatically better: c03's extra procedure accompanied the acceptance-scope error.

These are observations of this harness, not deployment latency benchmarks. Behavior runs forced the case's complete skill set at every fresh stage; subjects and graders sometimes overlapped. This includes loading cost and inference contention that selective native activation might avoid. CLI manifests identify **codex-cli 0.139.0**, exact invocation and frozen source hashes. The resolved model identifier was not disclosed by its event stream; both arms used the same host default selection, not a claimed named model.

The [dimension summary](results/2026-09-27/dimension-summary.json) reports 0–3 judge scores with sample counts, ranges and sample deviations. Comparison baselines stay separate. A second judge of one output is never counted as a second subject. Most case/dimension samples have N=1; c01 and c05 have two corrected independent runs per arm. Small samples and uncertain rubric judgments do not justify population confidence or an aggregate skill pass rate.

The host still exposed normal system context, a skill catalog and MCP registrations. Subjects were directed to use only supplied guidance, and captured traces were inspected. Thus “none” means **no supplied task-specific guidance**, not an empty model context or perfectly isolated skill loader. Routing used descriptions in a forced-choice prompt; actual host-trigger behavior remains unmeasured.

## Changes to consider, separately from this assessment

1. Narrow spec-authoring's trigger to semantic contract work so anchor, spelling and formatting maintenance stays lightweight. Retest t17 and reserved contextual negatives with actual native activation if a controllable host becomes available.
2. Preserve acceptance at the level of individual obligations. The c03 latest-default sentence needs explicit acceptance or proposal status; a generally accepted document must not ratify newly added neighboring behavior. Use reserved cases covering pending decisions and fresh-session authority before adopting a broad procedural fix.
3. Retain the useful discoverability and reasoning practices shown by c01, c06 and c07. Their value is the preserved decision and usable handoff, not a required number of files or headings.
4. Measure selective loading and human usefulness before claiming efficiency or broad superiority. Keep baseline ties, failed controls, original ambiguous runs and grader disputes in the record.

No improvement is applied in this evaluation. A candidate revision should receive a new frozen snapshot, regressions and untouched holdouts rather than being tuned against every visible case.
