import { defineConfig } from '@ai-plugin-marketplace/core';

/**
 * Keeps the established plugin identity while exposing one connected design/specification
 * experience. Shared skills and references ship together; host manifests describe native
 * components, and aipm generates the marketplace registrations and hook artifacts.
 */
export default defineConfig({
  version: "0.1.0",
  targets: ["claude", "cursor", "codex"],
  description: "Connected design and specification work: Deep Design, domain planning, spec authoring, and alignment review with shared decisions, repository artifacts, and resumable handoffs.",
  keywords: ["design", "domain-modeling", "specifications", "review", "continuity"],
});
