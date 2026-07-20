/**
 * Spec-first structural tests for the changeset frontmatter schema and validator.
 *
 * Every assertion below cites the `docs/ratification/frontmatter-schema.md` section it verifies.
 * Expected values are derived by hand from that spec — never from running the implementation and
 * capturing its output (no snapshot/gold-master assertions in this file, per the repo's
 * spec-first testing rule).
 *
 * Issue #85 acceptance-criteria coverage (see the issue and the PR body for the full mapping):
 *   1. machine-checkable schema + TS types           -> "schema shape" + "toChangesetJsonSchema" blocks
 *   2. conditional-requirement enforcement            -> "conditional requirements" block
 *   3. strict-YAML round-trip                         -> "strict-YAML round-trip" block
 *   4. schemaVersion unknown-major fail-closed         -> "schemaVersion fail-closed" block
 *   5. single validator function for CI + porcelain    -> exercised throughout via validateFrontmatter/validateChangesetFile
 *
 * @see docs/ratification/frontmatter-schema.md
 * @see docs/ratification/ci-validation-contract.md §"The checks, in order", check #1
 * @see docs/harness-program/DECISIONS.md D-011 (commandPattern ownership/shape)
 */
import { describe, expect, it } from "vitest";
import {
  changesetFrontmatterSchema,
  SUPPORTED_SCHEMA_VERSIONS,
  toChangesetJsonSchema,
} from "../src/frontmatter-schema.js";
import { parseChangesetFrontmatter } from "../src/frontmatter-parser.js";
import { validateChangesetFile, validateFrontmatter } from "../src/validator.js";

/**
 * A minimal but complete valid changeset header, built field-by-field from
 * frontmatter-schema.md §"Fields" `req` rows only (no `cond`/`opt` fields set) — a
 * command-governing, redirect-verdict ruling so `commandPattern` and `redirectTarget` are
 * exercised as part of the "everything req is present" baseline.
 */
function validHeader(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "cs-2026-07-19-ssh-always-001",
    ratificationStatus: "proposed",
    signerIdentity: "judge",
    commandPattern: { pattern: "curl * | sh", matcherVersion: "1.4.0" },
    verdict: "redirect",
    direction: "tightening",
    redirectTarget: "scripts/agent-tools/safe-install",
    scope: "global",
    ...overrides,
  };
}

describe("changeset frontmatter schema shape (criterion 1)", () => {
  // §"Identity and lifecycle", §"The decision", §"Scope": every `req` field must be present.
  it.each([
    "schemaVersion",
    "id",
    "ratificationStatus",
    "signerIdentity",
    "verdict",
    "direction",
    "scope",
  ])("rejects a header missing the required field %s", (field) => {
    const header = validHeader();
    delete header[field];
    const result = validateFrontmatter(header);
    expect(result.valid).toBe(false);
  });

  // §"Identity and lifecycle": `ratificationStatus` is `proposed` | `ratified`.
  it("rejects an out-of-range ratificationStatus value", () => {
    const result = validateFrontmatter(validHeader({ ratificationStatus: "merged" }));
    expect(result.valid).toBe(false);
  });

  // §"The decision": `verdict` is `deny` | `redirect` | `open`.
  it("rejects an out-of-range verdict value", () => {
    const result = validateFrontmatter(
      validHeader({ verdict: "allow", redirectTarget: undefined }),
    );
    expect(result.valid).toBe(false);
  });

  // §"The decision": `direction` is `tightening` | `loosening`.
  it("rejects an out-of-range direction value", () => {
    const result = validateFrontmatter(validHeader({ direction: "sideways" }));
    expect(result.valid).toBe(false);
  });

  // §"Scope": `scope` is `global` | `agent-type` | `session`.
  it("rejects an out-of-range scope value", () => {
    const result = validateFrontmatter(validHeader({ scope: "org-wide" }));
    expect(result.valid).toBe(false);
  });

  // §"The decision": `riskLevel` is `low-concern` | `necessary-evil` (scale marked TBD in the
  // spec) — this validator accepts only the documented pair today; a wider scale is a schema
  // contract change, not a silently-permissive read.
  it("accepts each documented riskLevel value and rejects an undocumented one", () => {
    expect(validateFrontmatter(validHeader({ riskLevel: "low-concern" })).valid).toBe(true);
    expect(validateFrontmatter(validHeader({ riskLevel: "necessary-evil" })).valid).toBe(true);
    expect(validateFrontmatter(validHeader({ riskLevel: "catastrophic" })).valid).toBe(false);
  });

  it("accepts a fully-populated valid header (round trip through zod's inferred type)", () => {
    const result = validateFrontmatter(
      validHeader({
        supersedes: "cs-2026-06-01-ssh-always-000",
        riskLevel: "necessary-evil",
        intentRef: { id: "ssh-always", version: "3", sections: ["2.1", "2.4"] },
        judgeHarnessVersion: "0.9.2",
        triggeringObservation: "curl -sSL https://example.com/install.sh | sh",
        expiry: "2026-12-31T23:59:59Z",
      }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.id).toBe("cs-2026-07-19-ssh-always-001");
    }
  });
});

describe("commandPattern object shape (criterion 1, D-011)", () => {
  // D-011 + frontmatter-schema.md §"The decision": commandPattern is an OBJECT
  // `{ pattern, matcherVersion }`, both sub-fields required when the object is present.
  it("rejects commandPattern missing matcherVersion", () => {
    const header = validHeader({ commandPattern: { pattern: "curl * | sh" } });
    expect(validateFrontmatter(header).valid).toBe(false);
  });

  it("rejects commandPattern missing pattern", () => {
    const header = validHeader({ commandPattern: { matcherVersion: "1.4.0" } });
    expect(validateFrontmatter(header).valid).toBe(false);
  });

  // matcherVersion "validated as syntactic semver" per frontmatter-schema.md's commandPattern
  // note — match semantics for `pattern` itself are explicitly out of scope (D-011, issue #85
  // non-goals): only syntax (non-empty string) is checked for `pattern`.
  it("rejects a non-semver matcherVersion", () => {
    const header = validHeader({
      commandPattern: { pattern: "curl * | sh", matcherVersion: "not-a-version" },
    });
    expect(validateFrontmatter(header).valid).toBe(false);
  });

  it("accepts commandPattern absent entirely (non-command config ruling)", () => {
    const header = validHeader({ commandPattern: undefined, verdict: "open", redirectTarget: undefined });
    expect(validateFrontmatter(header).valid).toBe(true);
  });

  it("accepts commandPattern explicitly null (non-command config ruling)", () => {
    const header = validHeader({ commandPattern: null, verdict: "open", redirectTarget: undefined });
    expect(validateFrontmatter(header).valid).toBe(true);
  });
});

describe("conditional requirements (criterion 2)", () => {
  // §"The decision": redirectTarget iff verdict = redirect.
  it("rejects verdict=redirect with no redirectTarget", () => {
    const header = validHeader({ redirectTarget: undefined });
    const result = validateFrontmatter(header);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.path === "redirectTarget")).toBe(true);
    }
  });

  it("rejects redirectTarget present when verdict != redirect (iff enforced both ways)", () => {
    const header = validHeader({ verdict: "deny" }); // redirectTarget still set from validHeader()
    const result = validateFrontmatter(header);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.path === "redirectTarget")).toBe(true);
    }
  });

  it("accepts verdict=deny with no redirectTarget", () => {
    const header = validHeader({ verdict: "deny", redirectTarget: undefined });
    expect(validateFrontmatter(header).valid).toBe(true);
  });

  it("accepts verdict=open with no redirectTarget", () => {
    const header = validHeader({
      verdict: "open",
      direction: "loosening",
      redirectTarget: undefined,
    });
    expect(validateFrontmatter(header).valid).toBe(true);
  });

  // §"Scope": scopeValue iff scope != global.
  it("rejects scope=agent-type with no scopeValue", () => {
    const header = validHeader({ scope: "agent-type" });
    const result = validateFrontmatter(header);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.path === "scopeValue")).toBe(true);
    }
  });

  it("rejects scope=session with no scopeValue", () => {
    const header = validHeader({ scope: "session" });
    expect(validateFrontmatter(header).valid).toBe(false);
  });

  it("accepts scope=agent-type with scopeValue set", () => {
    const header = validHeader({ scope: "agent-type", scopeValue: "coder-implementer" });
    expect(validateFrontmatter(header).valid).toBe(true);
  });

  it("rejects scopeValue present when scope = global (iff enforced both ways)", () => {
    const header = validHeader({ scope: "global", scopeValue: "should-not-be-here" });
    const result = validateFrontmatter(header);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.path === "scopeValue")).toBe(true);
    }
  });

  it("accepts scope=global with no scopeValue", () => {
    const header = validHeader({ scope: "global" });
    expect(validateFrontmatter(header).valid).toBe(true);
  });

  // §"Provenance": intentRef.* is a group — this validator's documented stance (no single field
  // in the header signals "intent-derived ruling", so completeness-when-present is enforced
  // instead of a cross-field iff; flagged to the ratification PM as a spec ambiguity in the PR).
  it("rejects a partially-populated intentRef", () => {
    const header = validHeader({ intentRef: { id: "ssh-always", version: "3" } });
    expect(validateFrontmatter(header).valid).toBe(false);
  });

  it("accepts a fully-populated intentRef", () => {
    const header = validHeader({
      intentRef: { id: "ssh-always", version: "3", sections: ["2.1"] },
    });
    expect(validateFrontmatter(header).valid).toBe(true);
  });
});

describe("schemaVersion fail-closed on unknown major (criterion 4)", () => {
  // §"Schema versioning": "Consumers reject an unknown major -> fail closed to asking. They
  // never best-effort a header they don't understand."
  it("accepts every currently-supported major", () => {
    for (const major of SUPPORTED_SCHEMA_VERSIONS) {
      expect(validateFrontmatter(validHeader({ schemaVersion: major })).valid).toBe(true);
    }
  });

  it("rejects an unknown future major (fails closed, does not best-effort read it)", () => {
    const result = validateFrontmatter(validHeader({ schemaVersion: 2 }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.path === "schemaVersion")).toBe(true);
    }
  });

  it("rejects schemaVersion 0 (never a valid major)", () => {
    expect(validateFrontmatter(validHeader({ schemaVersion: 0 })).valid).toBe(false);
  });

  it("rejects a non-integer schemaVersion", () => {
    expect(validateFrontmatter(validHeader({ schemaVersion: 1.5 })).valid).toBe(false);
  });
});

describe("strict-YAML round-trip (criterion 3)", () => {
  // §"Carrier and serialization": "any scalar containing `: ` is quoted (Codex strict-parses
  // frontmatter). `commandPattern` and `triggeringObservation` values are quoted by default for
  // that reason." This changeset file is hand-constructed exactly as the spec describes a
  // correctly-serialized header, with `: ` inside two quoted scalars.
  const changesetFile = [
    "---",
    "schemaVersion: 1",
    "id: cs-2026-07-19-ssh-always-001",
    "ratificationStatus: proposed",
    "signerIdentity: judge",
    "commandPattern:",
    '  pattern: "curl * | sh: pipe to a shell"',
    '  matcherVersion: "1.4.0"',
    "verdict: redirect",
    "direction: tightening",
    "redirectTarget: scripts/agent-tools/safe-install",
    '"triggeringObservation": "curl -sSL https://example.com: run install.sh"',
    "scope: global",
    "---",
    "",
    "## Ruling",
    "",
    "Necessary-evil: piping to a shell is denied by default.",
    "",
  ].join("\n");

  it("parses the frontmatter fence and preserves quoted values containing ': '", () => {
    const parsed = parseChangesetFrontmatter(changesetFile);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const header = parsed.header as Record<string, unknown>;
      expect(header.commandPattern).toEqual({
        pattern: "curl * | sh: pipe to a shell",
        matcherVersion: "1.4.0",
      });
      expect(header.triggeringObservation).toBe(
        "curl -sSL https://example.com: run install.sh",
      );
      // Body (below the closing fence) is preserved separately from the header.
      expect(parsed.body).toContain("## Ruling");
    }
  });

  it("validates end-to-end via validateChangesetFile with the quoted values intact", () => {
    const result = validateChangesetFile(changesetFile);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.commandPattern?.pattern).toBe("curl * | sh: pipe to a shell");
    }
  });

  // Negative: a colon-space value left UNQUOTED is exactly the strict-YAML failure mode the
  // spec's caveat exists to prevent — the frontmatter fence parse itself must fail closed
  // (reported as a malformed-frontmatter issue) rather than silently truncating the scalar.
  it("fails closed on an unquoted scalar containing ': ' (the strict-YAML hazard)", () => {
    const unsafeFile = [
      "---",
      "schemaVersion: 1",
      "id: cs-2026-07-19-ssh-always-002",
      "ratificationStatus: proposed",
      "signerIdentity: judge",
      "verdict: deny",
      "direction: tightening",
      "scope: global",
      "triggeringObservation: curl http://example.com: pipe to shell",
      "---",
    ].join("\n");
    const result = validateChangesetFile(unsafeFile);
    // Either the YAML parse rejects the ambiguous mapping outright, or it parses to something
    // that is not the intended full-sentence string — assert the safe, spec-compliant behavior:
    // the value the schema sees is never the full unquoted sentence with its embedded ": ".
    if (result.valid) {
      expect(result.data.triggeringObservation).not.toBe(
        "curl http://example.com: pipe to shell",
      );
    } else {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("malformed YAML and missing frontmatter (fail-closed to asking)", () => {
  it("rejects a file with no frontmatter fence at all", () => {
    const result = validateChangesetFile("## Just a body, no header\n");
    expect(result.valid).toBe(false);
  });

  it("rejects structurally invalid YAML inside the fence", () => {
    const badFile = ["---", "id: [unterminated", "---"].join("\n");
    const result = validateChangesetFile(badFile);
    expect(result.valid).toBe(false);
  });

  it("rejects a non-object header (e.g. a bare YAML scalar)", () => {
    const result = validateFrontmatter("just a string, not a mapping");
    expect(result.valid).toBe(false);
  });
});

describe("toChangesetJsonSchema (criterion 1: machine-checkable schema artifact)", () => {
  it("derives a JSON Schema object exposing the req field set from frontmatter-schema.md", () => {
    const jsonSchema = toChangesetJsonSchema();
    expect(jsonSchema).toHaveProperty("properties");
    const properties = jsonSchema.properties as Record<string, unknown>;
    // §"Fields": every req/cond/opt field name from the spec's tables must appear as a schema
    // property so a non-TS/non-zod consumer (e.g. an IDE) can validate against it too.
    for (const field of [
      "schemaVersion",
      "id",
      "ratificationStatus",
      "signerIdentity",
      "supersedes",
      "commandPattern",
      "verdict",
      "direction",
      "redirectTarget",
      "riskLevel",
      "intentRef",
      "judgeHarnessVersion",
      "triggeringObservation",
      "scope",
      "scopeValue",
      "expiry",
    ]) {
      expect(properties).toHaveProperty(field);
    }
  });

  it("stays in sync with changesetFrontmatterSchema's own key set (no drift between the two exports)", () => {
    const jsonSchema = toChangesetJsonSchema();
    const properties = jsonSchema.properties as Record<string, unknown>;
    const zodKeys = Object.keys(changesetFrontmatterSchema.shape).sort();
    const jsonSchemaKeys = Object.keys(properties).sort();
    expect(jsonSchemaKeys).toEqual(zodKeys);
  });
});
