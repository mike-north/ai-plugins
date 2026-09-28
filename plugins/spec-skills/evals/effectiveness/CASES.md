# Scenario map

This is the coverage plan, not execution evidence. See the results record for completed and unrun cases. Subject inputs and hidden judgments remain separate in [corpus.json](corpus.json) and [graders.json](graders.json).

## Behavior cases

| ID | Domain | Risk | Skills | Stages | Capability | Split |
| --- | --- | --- | --- | --- | --- | --- |
| c01 | team automation product | high | deep-design, domain-planning | 1 | repository | calibration |
| c02 | warehouse fulfillment | medium | domain-planning, deep-design | 1 | repository | calibration |
| c03 | extension adoption audit | high | spec-audit, spec-authoring, domain-planning | 3 | repository | calibration |
| c04 | scheduling and contributor handoff | medium | domain-planning, spec-authoring | 2 | repository | calibration |
| c05 | markdown-only access review | high | spec-audit | 1 | markdown-only | calibration |
| c06 | migration work coordination | medium | domain-planning, spec-authoring | 1 | repository | calibration |
| c07 | credential meaning changes | high | spec-audit, spec-authoring | 1 | repository | calibration |
| c08 | primary extension journey | high | deep-design, domain-planning, spec-authoring, spec-audit | 4 | repository | calibration |
| b09 | payments release scoping | medium | spec-audit | 1 | repository | holdout |
| b10 | review context portability | high | spec-audit | 1 | repository | holdout |
| b11 | private contract missing from revision | high | spec-audit | 1 | repository | holdout |
| b12 | worktree sharing boundary | high | domain-planning | 1 | repository | holdout |
| b13 | isolated worktrees | medium | domain-planning | 1 | repository | holdout |
| b14 | compression reversal | high | domain-planning, spec-authoring, spec-audit | 1 | repository | holdout |
| b15 | evaluator responsibility drift | high | spec-audit | 1 | repository | holdout |
| b16 | storage representation false alarm | medium | spec-audit | 1 | repository | holdout |
| b17 | narrow documentation edit | low | spec-authoring | 1 | repository | holdout |
| b18 | consumer questions before transport | high | domain-planning | 1 | repository | holdout |
| b19 | independent review disagreement | high | domain-planning | 1 | repository | holdout |
| b20 | normative artifact examples | medium | spec-audit | 1 | repository | holdout |
| b21 | plan quality separate from conformance | high | domain-planning, spec-audit | 1 | repository | holdout |
| b22 | missing migration evidence | medium | spec-audit | 1 | repository | holdout |
| b23 | unaccepted neighboring text | medium | spec-authoring | 1 | repository | holdout |
| b24 | inquiry resume mid-comparison | medium | deep-design, domain-planning | 2 | repository | holdout |
| b25 | tracked solo working records | medium | domain-planning | 1 | repository | holdout |
| b26 | existing collection layout | medium | spec-authoring | 1 | repository | holdout |
| b27 | generated display regression | medium | spec-audit | 1 | repository | holdout |
| b28 | apparent rename with changed meaning | high | spec-authoring, domain-planning | 1 | repository | holdout |
| b29 | event time versus current state | high | domain-planning, spec-authoring | 1 | repository | holdout |
| b30 | accepted boundary with ordinary implementation | medium | spec-audit | 1 | repository | holdout |
| b31 | markdown-only missing meaning | high | spec-audit, spec-authoring, domain-planning | 1 | markdown-only | holdout |
| b32 | decision history versus migration approval | high | spec-authoring | 1 | repository | holdout |
| b33 | campaign closeout retention | medium | domain-planning, spec-authoring | 1 | repository | holdout |
| b34 | evidence contradicts intent comments | medium | spec-audit | 1 | repository | holdout |
| b35 | narrow accepted authoring without detour | medium | spec-authoring | 1 | repository | holdout |
| b36 | cross-scope compression counterexample | high | deep-design, domain-planning | 1 | repository | holdout |

## Routing descriptions

Routing cases test selection from descriptions. They do not establish automatic host activation. Positive, contextual and negative jobs are mixed; the grader decides whether added routes are justified, rather than demanding a magic string.

| ID | Request | Split |
| --- | --- | --- |
| t01 | Use Deep Design to challenge the five installation products in our rough concept sketch and look for a smaller model before we settle it. | calibration |
| t02 | Use domain planning to describe which facts belong to an invoice, a payment attempt, and a payment allocation. We have situations but no coherent plan. | holdout |
| t03 | Use spec authoring to turn the accepted cancellation decision into precise obligations and boundary examples. | holdout |
| t04 | Use spec audit to compare the refund implementation with the accepted partial-refund contract. | holdout |
| t05 | Every time we add a use case we invent another kind of installation. Before adding a sixth, challenge the assumptions and see whether one organizing idea can explain the important cases. | calibration |
| t06 | Our policy, rule, and constraint objects sound interchangeable. Help us work out what each is for, what changes independently, and which questions a support agent should be able to answer. | holdout |
| t07 | The team already chose explicit version adoption. Write the operation’s preconditions, failures, successful result, and validation examples, reusing the domain plan. | holdout |
| t08 | This branch returns the right boolean, but the evaluator now sends notifications. Check whether that belongs in its responsibility according to our plan. | holdout |
| t09 | Resume the comparison recorded in .work/models.md. We were asking whether publication and adoption are really the same event; do not restart the whole product discussion. | calibration |
| t10 | The accepted plan says cancellation preserves history. Find out whether this patch and its tests still honor that, including the generated account summary. | holdout |
| t11 | Our draft contract links to the domain plan, but its account scope changed last week. Reconcile the contract’s obligations and examples with the accepted meaning, preserving unresolved decisions. | holdout |
| t12 | We have a domain plan, but I think it answers the wrong customer question. Assess the plan’s purpose and distinctions without assuming matching code makes the model good. | holdout |
| t13 | Translate the phrase "domain planning" into French. Do not explain software methodology. | calibration |
| t14 | Fix the spelling of succesful in this sentence: "A succesful request returns 200." | holdout |
| t15 | What does HTTP status code 404 mean? One sentence is enough. | holdout |
| t16 | Implement the accepted helper in src/add.py: add(a,b) returns a+b. The contract is settled; write its tests first and keep this to code. | holdout |
| t17 | In our accepted specification, the link to domain.md#usage-identitiy has a typo; the target heading is Usage identity. Correct that Markdown anchor only. Do not reassess the identity decision or change any contract prose. | calibration |
| t18 | Our domain expires next month. Explain what renewing a DNS domain name means. | holdout |
| t19 | Review the benchmark harness for measurement reliability: it times a parser with a cold process for the old version and a warm process for the new version. Explain what makes the timing comparison unfair and how to rerun it. The parser behavior and design are out of scope. | holdout |
| t20 | Summarize the benchmark output: 20 ms before, 15 ms after. Calculate the percentage improvement. | holdout |
| t21 | We have already accepted a single-process local cache with disposable data and at most 10,000 entries. For a two-day implementation, compare an in-memory dictionary with SQLite on startup cost and implementation effort. Work within that fixed frame; do not reopen the product/domain model or write a specification. | holdout |
| t22 | Estimate the engineering work for our settled API change: add optional page_size, default 50, maximum 100, to an existing list handler that already supports limit. The contract and examples are approved. Give a rough effort range and the implementation steps; do not author or audit the specification. | holdout |
| t23 | Draft an email inviting our architect to a design review on Thursday. The only task is the invitation. | holdout |
| t24 | The spec says timeout is 30 seconds and the test expects 3. Determine which source governs and whether the test or contract needs correction. | calibration |
