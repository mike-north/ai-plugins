/**
 * Tests for Claude → Gemini hook translation in src/build-hooks.ts.
 *
 * Hooks are authored once in `hooks/claude.yaml` (Claude's event vocabulary) and
 * built into Gemini's `hooks.json`. Gemini uses different event NAMES for the same
 * lifecycle points, so the build must rename event keys — not just tool matchers —
 * and omit events Gemini has no equivalent for (rather than emit an invalid event).
 *
 * @see https://code.claude.com/docs/en/hooks.md — Claude Code event names
 * @see https://geminicli.com/docs/hooks/ — Gemini CLI event names
 */
import { describe, expect, it, vi } from "vitest";

import { geminiEventNameFor, translateHooksForGemini } from "../src/build-hooks.js";

describe("geminiEventNameFor", () => {
  it("maps Claude tool/agent events to their Gemini equivalents", () => {
    expect(geminiEventNameFor("PreToolUse")).toBe("BeforeTool");
    expect(geminiEventNameFor("PostToolUse")).toBe("AfterTool");
    expect(geminiEventNameFor("UserPromptSubmit")).toBe("BeforeAgent");
    expect(geminiEventNameFor("Stop")).toBe("AfterAgent");
    expect(geminiEventNameFor("PreCompact")).toBe("PreCompress");
  });

  it("passes through events Gemini supports under the same name", () => {
    // SessionEnd is the event the dream plugin's auto-trigger uses — must be portable as-is.
    expect(geminiEventNameFor("SessionStart")).toBe("SessionStart");
    expect(geminiEventNameFor("SessionEnd")).toBe("SessionEnd");
    expect(geminiEventNameFor("Notification")).toBe("Notification");
  });

  it("returns null for Claude events with no Gemini equivalent (negative)", () => {
    for (const claudeOnly of ["SubagentStop", "Setup", "PostToolBatch", "PreCompact ", "Bogus"]) {
      // (note: "PreCompact " with a trailing space is deliberately unmapped)
      expect(geminiEventNameFor(claudeOnly)).toBeNull();
    }
  });
});

describe("translateHooksForGemini", () => {
  it("renames event keys and translates tool matchers together", () => {
    const out = translateHooksForGemini({
      hooks: {
        PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "echo hi" }] }],
      },
    });
    expect(out.hooks).toHaveProperty("BeforeTool");
    expect(out.hooks).not.toHaveProperty("PreToolUse");
    expect(out.hooks?.["BeforeTool"]?.[0]?.matcher).toBe("write_file");
  });

  it("passes a SessionEnd hook through unchanged (the dream-plugin case)", () => {
    const out = translateHooksForGemini({
      hooks: {
        SessionEnd: [{ hooks: [{ type: "command", command: "node should-dream.mjs" }] }],
      },
    });
    expect(out.hooks).toHaveProperty("SessionEnd");
    expect(out.hooks?.["SessionEnd"]?.[0]?.hooks?.[0]?.command).toBe("node should-dream.mjs");
  });

  it("omits unsupported events and warns once per omission (negative)", () => {
    const warnings: string[] = [];
    const out = translateHooksForGemini(
      {
        hooks: {
          SessionEnd: [{ hooks: [{ type: "command", command: "keep" }] }],
          SubagentStop: [{ hooks: [{ type: "command", command: "drop" }] }],
        },
      },
      (m) => warnings.push(m),
    );
    expect(out.hooks).toHaveProperty("SessionEnd");
    expect(out.hooks).not.toHaveProperty("SubagentStop");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("SubagentStop");
  });

  it("merges two Claude events that map onto the same Gemini event", () => {
    // Stop → AfterAgent; an explicit AfterAgent (already Gemini-native) shares the key.
    const out = translateHooksForGemini({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "a" }] }],
        AfterAgent: [{ hooks: [{ type: "command", command: "b" }] }],
      },
    });
    expect(out.hooks?.["AfterAgent"]?.length).toBe(2);
  });

  it("does not mutate the source object", () => {
    const source = { hooks: { PreToolUse: [{ matcher: "Write", hooks: [] }] } };
    translateHooksForGemini(source, () => {});
    expect(source.hooks).toHaveProperty("PreToolUse");
    expect(source.hooks.PreToolUse[0]?.matcher).toBe("Write");
  });

  it("handles a hooks file with no hooks key", () => {
    expect(translateHooksForGemini({})).toEqual({});
  });
});
