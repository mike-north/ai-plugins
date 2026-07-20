/**
 * The changeset frontmatter schema — a program contract.
 *
 * Single source of truth for the structured YAML header every ratification changeset carries.
 * Both the CI validation action (issue #86) and the porcelain tool (issue #88) validate against
 * this module rather than hand-rolling their own parsers.
 *
 * Defined with `zod` (already a dependency of `@ai-plugin-marketplace/core`, which this repo's
 * own tooling uses for exactly this purpose: a schema that is simultaneously a runtime validator
 * and a TypeScript type source via `z.infer`). `toChangesetJsonSchema()` derives a JSON Schema
 * view from the same definition via zod's native `toJSONSchema`, satisfying "a machine-checkable
 * schema (JSON Schema or equivalent)" without a second, driftable definition.
 *
 * @see docs/ratification/frontmatter-schema.md — the governing field set, grouping, and
 *   versioning rules this module implements. Section references below point into that document.
 */
import { z } from "zod";

/**
 * Known `schemaVersion` majors this validator accepts.
 *
 * frontmatter-schema.md §"Schema versioning": `schemaVersion` **is** the major (a plain integer,
 * bumped only by a breaking/contract change). Consumers reject an unknown major — fail closed to
 * asking, never a best-effort read of a header shape they don't understand.
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

/** frontmatter-schema.md §"Identity and lifecycle" — `ratificationStatus` enum. */
const ratificationStatusEnum = z.enum(["proposed", "ratified"]);

/** frontmatter-schema.md §"The decision" — `verdict` enum (mirrors steering's verdict vocabulary). */
const verdictEnum = z.enum(["deny", "redirect", "open"]);

/** frontmatter-schema.md §"The decision" — `direction` enum. */
const directionEnum = z.enum(["tightening", "loosening"]);

/**
 * frontmatter-schema.md §"The decision" — `riskLevel` enum. The doc flags the scale as "TBD";
 * this validator intentionally accepts only the two values documented today (fail-closed: a
 * future scale expansion is a contract change to this module, not silently permissive).
 */
const riskLevelEnum = z.enum(["low-concern", "necessary-evil"]);

/** frontmatter-schema.md §"Scope" — `scope` enum (the grant-tuple vocabulary). */
const scopeEnum = z.enum(["global", "agent-type", "session"]);

/**
 * Syntactic semver (`MAJOR.MINOR.PATCH` with optional pre-release/build metadata), per
 * frontmatter-schema.md's `commandPattern.matcherVersion` note: "Validated as syntactic semver
 * here; *satisfiability* ... is decided by steering's compatibility contract" — this module
 * checks shape only, never version compatibility.
 * @see https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
 */
const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

/** ISO-8601 instant, per frontmatter-schema.md's `expiry` note (matches the grant-tuple field). */
const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * frontmatter-schema.md §"The decision" — `commandPattern`. Per
 * [D-011](../../../docs/harness-program/DECISIONS.md), an object `{ pattern, matcherVersion }`
 * with **both sub-fields required when the object is present**. `pattern` is validated
 * syntactically only (non-empty string) — match *semantics* are command-steering's matcher,
 * never reimplemented here (explicit non-goal of issue #85).
 */
export const commandPatternSchema = z.object({
  pattern: z.string().min(1, "commandPattern.pattern must not be empty"),
  matcherVersion: z
    .string()
    .regex(SEMVER_RE, "commandPattern.matcherVersion must be syntactic semver (MAJOR.MINOR.PATCH)"),
});

/**
 * frontmatter-schema.md §"Provenance" — `intentRef.*`. The doc marks each sub-field `cond`,
 * "required for intent-derived rulings" — a condition this schema has no other field to key off
 * of. This module's stance (flagged for the ratification PM in the issue #85 PR): `intentRef` as
 * a whole is optional, but when present it must be complete — `id`, `version`, and `sections`
 * are all required together, so a changeset never carries a half-populated citation.
 */
export const intentRefSchema = z.object({
  id: z.string().min(1, "intentRef.id must not be empty"),
  version: z.string().min(1, "intentRef.version must not be empty"),
  sections: z.array(z.string().min(1)).min(1, "intentRef.sections must not be empty"),
});

/**
 * The changeset frontmatter, field-for-field per frontmatter-schema.md §"Fields". `req` fields
 * are non-optional here; `opt` fields are `.optional()`; `cond` fields are `.optional()` at the
 * shape level (their conditions are enforced in {@link changesetFrontmatterSchema}'s
 * `superRefine`, since a condition like "iff verdict = redirect" is cross-field).
 */
const baseShape = {
  // Identity and lifecycle
  schemaVersion: z.number().int(),
  id: z.string().min(1, "id must not be empty"),
  ratificationStatus: ratificationStatusEnum,
  signerIdentity: z.string().min(1, "signerIdentity must not be empty"),
  supersedes: z.string().min(1).nullable().optional(),

  // The decision
  commandPattern: commandPatternSchema.nullable().optional(),
  verdict: verdictEnum,
  direction: directionEnum,
  redirectTarget: z.string().min(1).optional(),
  riskLevel: riskLevelEnum.optional(),

  // Provenance
  intentRef: intentRefSchema.optional(),
  judgeHarnessVersion: z.string().min(1).nullable().optional(),
  triggeringObservation: z.string().optional(),

  // Scope
  scope: scopeEnum,
  scopeValue: z.string().min(1).optional(),
  expiry: z.string().regex(ISO_INSTANT_RE).nullable().optional(),
};

/**
 * The full changeset frontmatter schema, including the cross-field conditional-requirement
 * rules from frontmatter-schema.md that a flat object shape can't express:
 *
 * - `schemaVersion` must be a known major (§"Schema versioning" — fail closed on unknown).
 * - `redirectTarget` **iff** `verdict = redirect` (§"The decision").
 * - `scopeValue` **iff** `scope != global` (§"Scope").
 *
 * "iff" (not just "if") is enforced in both directions: a `redirectTarget` on a non-`redirect`
 * verdict, or a `scopeValue` on `global` scope, is rejected too — fail closed rather than
 * silently accepting a header shape the schema doesn't expect.
 */
export const changesetFrontmatterSchema = z.object(baseShape).superRefine((value, ctx) => {
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(value.schemaVersion)) {
    ctx.addIssue({
      code: "custom",
      path: ["schemaVersion"],
      message: `schemaVersion ${value.schemaVersion} is an unknown major (supported: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}) — fail closed, not applied.`,
    });
  }

  const hasRedirectTarget =
    value.redirectTarget !== undefined && value.redirectTarget !== null;
  if (value.verdict === "redirect" && !hasRedirectTarget) {
    ctx.addIssue({
      code: "custom",
      path: ["redirectTarget"],
      message: "redirectTarget is required when verdict = redirect.",
    });
  }
  if (value.verdict !== "redirect" && hasRedirectTarget) {
    ctx.addIssue({
      code: "custom",
      path: ["redirectTarget"],
      message: "redirectTarget must be absent unless verdict = redirect.",
    });
  }

  const hasScopeValue = value.scopeValue !== undefined && value.scopeValue !== null;
  if (value.scope !== "global" && !hasScopeValue) {
    ctx.addIssue({
      code: "custom",
      path: ["scopeValue"],
      message: "scopeValue is required when scope != global.",
    });
  }
  if (value.scope === "global" && hasScopeValue) {
    ctx.addIssue({
      code: "custom",
      path: ["scopeValue"],
      message: "scopeValue must be absent when scope = global.",
    });
  }
});

/** The changeset frontmatter, typed. Derived from {@link changesetFrontmatterSchema} — never hand-duplicated. */
export type ChangesetFrontmatter = z.infer<typeof changesetFrontmatterSchema>;

/**
 * Derive a JSON Schema view of {@link changesetFrontmatterSchema} for consumers that want a
 * language-agnostic artifact (e.g. an editor/IDE integration) rather than importing zod
 * directly. The zod schema — not this export — is the source of truth; this is a projection.
 */
export function toChangesetJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(changesetFrontmatterSchema) as Record<string, unknown>;
}
