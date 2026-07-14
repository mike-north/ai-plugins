// Compatibility shim: sarif.mjs moved to lib/sarif.mjs (extended with the
// capture-core per-reviewer SARIF profile). Re-exported here so existing
// imports of this path keep working unchanged.
export * from "./lib/sarif.mjs";
