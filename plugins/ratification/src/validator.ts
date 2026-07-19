/**
 * The single validator function — used by both the CI validation action (issue #86, per
 * ci-validation-contract.md check #1 "Frontmatter well-formedness") and the porcelain tool
 * (issue #88) so both consumers validate against one source of truth instead of hand-rolled
 * parsers.
 *
 * @see docs/ratification/frontmatter-schema.md — the field set this validates.
 * @see docs/ratification/ci-validation-contract.md §"The checks, in order", check #1.
 */
import { changesetFrontmatterSchema, type ChangesetFrontmatter } from "./frontmatter-schema.js";
import { parseChangesetFrontmatter } from "./frontmatter-parser.js";

export interface ValidationIssue {
  /** Dot-separated path into the frontmatter object (e.g. `"commandPattern.matcherVersion"`). */
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; data: ChangesetFrontmatter }
  | { valid: false; issues: ValidationIssue[] };

/**
 * Validate an already-parsed frontmatter object (e.g. `yaml.parse()` output) against the
 * changeset schema. Fails closed: any schema violation — missing `req` field, unknown enum
 * value, unmet conditional requirement, unknown `schemaVersion` major — is reported, never
 * silently accepted or best-effort-repaired.
 */
export function validateFrontmatter(input: unknown): ValidationResult {
  const result = changesetFrontmatterSchema.safeParse(input);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  return {
    valid: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

/**
 * Parse a full changeset file's text (frontmatter fence + body) and validate the header.
 * This is the entry point CI (check #1) and the porcelain tool call: it fails closed on
 * malformed YAML / a missing frontmatter fence exactly as it does on a schema violation, so
 * callers have one result shape to branch on rather than a parse error and a validation error.
 */
export function validateChangesetFile(fileText: string): ValidationResult {
  const parsed = parseChangesetFrontmatter(fileText);
  if (!parsed.ok) {
    return { valid: false, issues: [{ path: "", message: parsed.error }] };
  }
  return validateFrontmatter(parsed.header);
}
