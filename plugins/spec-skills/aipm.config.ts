import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Two model-invoked skills for software specifications: spec-audit (compare implementations, tests, or outputs against a governing spec and classify gaps) and spec-authoring (draft or revise thorough, testable specs with explicit scope, examples, and validation).",
  keywords: ["specs", "skills", "quality"],
});
