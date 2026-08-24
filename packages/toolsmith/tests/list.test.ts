/**
 * `toolsmith list` — deterministic registry inventory across both scopes,
 * with drift status, pending drafts (three-way state), shadowing, and parse
 * errors, per plugins/toolsmith/commands/list.md and
 * docs/toolsmith/cli-surface.md §Verbs.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupTmpDirs,
  newHome,
  newProj,
  revisionTool,
  newDraftTool,
  runCli,
  writeLive,
  writeProjectRegistry,
  writeStaged,
  writeUserRegistry,
} from "./helpers.js";

afterAll(cleanupTmpDirs);

describe("toolsmith list", () => {
  it("reports absent registries per scope, exit 0", () => {
    const r = runCli(["list"], { proj: newProj(), home: newHome() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("## Project tools");
    expect(r.stdout).toContain("## User tools");
    expect(r.stdout).toContain("no project tools registered");
    expect(r.stdout).toContain("no user tools registered");
  });

  it("renders an OK approved tool with its integrity status", () => {
    const proj = newProj();
    const home = newHome();
    const sha = writeLive(proj, "gh-x", "#!/bin/bash\necho x\n");
    writeProjectRegistry(proj, [
      { name: "gh-x", path: "scripts/agent-tools/gh-x", status: "approved", approvedSha256: sha },
    ]);
    const r = runCli(["list"], { proj, home });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("| gh-x |");
    expect(r.stdout).toContain("| OK |");
    expect(r.stdout).toContain("1 tool(s) — 1 OK, 0 drifted");
  });

  it("flags a drifted tool and exits 1", () => {
    const proj = newProj();
    const home = newHome();
    writeLive(proj, "gh-x", "#!/bin/bash\necho tampered\n");
    writeProjectRegistry(proj, [
      { name: "gh-x", path: "scripts/agent-tools/gh-x", status: "approved", approvedSha256: "0".repeat(64) },
    ]);
    const r = runCli(["list"], { proj, home });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("| DRIFTED |");
  });

  it("surfaces a parse error prominently instead of 'no tools registered'", () => {
    const proj = newProj();
    const home = newHome();
    writeFileSync(join(proj, ".claude", "toolsmith", "registry.json"), "{ not json !!!");
    const r = runCli(["list"], { proj, home });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("PARSE ERROR");
    expect(r.stdout).toContain("fails open");
    expect(r.stdout).not.toContain("no project tools registered");
  });

  it("shows a pending draft in state 'pending' when live matches its pin", () => {
    const proj = newProj();
    const home = newHome();
    const sha = writeLive(proj, "gh-x", "#!/bin/bash\necho v1\n");
    writeStaged(proj, "gh-x", "#!/bin/bash\necho v2\n");
    writeProjectRegistry(proj, [revisionTool("gh-x", sha)]);
    const r = runCli(["list"], { proj, home });
    expect(r.stdout).toContain("Pending drafts");
    expect(r.stdout).toContain("| pending |");
  });

  it("shows 'live-drifted-too' prominently when live no longer matches its pin", () => {
    const proj = newProj();
    const home = newHome();
    writeLive(proj, "gh-x", "#!/bin/bash\necho tampered\n");
    writeStaged(proj, "gh-x", "#!/bin/bash\necho v2\n");
    writeProjectRegistry(proj, [revisionTool("gh-x", "0".repeat(64))]);
    const r = runCli(["list"], { proj, home });
    expect(r.stdout).toContain("| live-drifted-too |");
    expect(r.stdout).toContain("stale diff");
  });

  it("shows 'staged-missing' when the registry claims a draft that isn't on disk", () => {
    const proj = newProj();
    const home = newHome();
    const sha = writeLive(proj, "gh-x", "#!/bin/bash\necho v1\n");
    writeProjectRegistry(proj, [revisionTool("gh-x", sha)]); // no writeStaged
    const r = runCli(["list"], { proj, home });
    expect(r.stdout).toContain("| staged-missing |");
  });

  it("shows 'new' for a brand-new draft tool", () => {
    const proj = newProj();
    const home = newHome();
    writeStaged(proj, "gh-new", "#!/bin/bash\necho new\n");
    writeProjectRegistry(proj, [newDraftTool("gh-new")]);
    const r = runCli(["list"], { proj, home });
    expect(r.stdout).toContain("| new |");
  });

  it("neutralizes backticks in registry fields so inline-code cells can't be broken (Copilot review: mdEscape did not escape backticks)", () => {
    const proj = newProj();
    const home = newHome();
    const sha = writeLive(proj, "gh-x", "#!/bin/bash\necho x\n");
    writeProjectRegistry(proj, [
      {
        name: "gh-x",
        path: "scripts/agent-tools/gh-x",
        status: "approved",
        approvedSha256: sha,
        purpose: "sneaky ` | injected` purpose",
      },
    ]);
    const r = runCli(["list"], { proj, home });
    expect(r.stdout).not.toContain("sneaky `");
    expect(r.stdout).toContain("sneaky ' \\| injected'");
  });

  it("notes project-shadows-user on a name collision", () => {
    const proj = newProj();
    const home = newHome();
    const shaP = writeLive(proj, "gh-x", "#!/bin/bash\necho project\n");
    writeProjectRegistry(proj, [
      { name: "gh-x", path: "scripts/agent-tools/gh-x", status: "approved", approvedSha256: shaP },
    ]);
    writeUserRegistry(home, [{ name: "gh-x", path: "tools/gh-x", status: "draft" }]);
    const r = runCli(["list"], { proj, home });
    expect(r.stdout).toContain("shadowed by project tool");
    expect(r.stdout).toContain("the project entry governs");
  });
});
