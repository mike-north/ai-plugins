/**
 * Public entry point for the ratification changeset frontmatter schema module.
 * @see docs/ratification/frontmatter-schema.md
 */
export {
  changesetFrontmatterSchema,
  commandPatternSchema,
  intentRefSchema,
  toChangesetJsonSchema,
  SUPPORTED_SCHEMA_VERSIONS,
  type ChangesetFrontmatter,
} from "./frontmatter-schema.js";

export { parseChangesetFrontmatter, type ParsedChangeset } from "./frontmatter-parser.js";

export {
  validateFrontmatter,
  validateChangesetFile,
  type ValidationIssue,
  type ValidationResult,
} from "./validator.js";
