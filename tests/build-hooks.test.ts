/**
 * Tests for Claude → Gemini / Codex hook translation in src/build-hooks.ts.
 *
 * Hooks are authored once in `hooks/claude.yaml` (Claude's event vocabulary) and
 * built per platform. Gemini uses different event NAMES for the same lifecycle
 * points (rename keys, omit unsupported events). Codex shares Claude's event names
 * but uses the PLUGIN_ROOT env var and an `apply_patch` edit tool.
 *
 * @see https://code.claude.com/docs/en/hooks.md — Claude Code event names
 * @see https://geminicli.com/docs/hooks/ — Gemini CLI event names
 * @see https://developers.openai.com/codex/hooks — Codex CLI event names
 */
import { describe, expect, it, vi } from "vitest";

import {
  geminiEventNameFor,
  translateHooksForGemini,
  codexEventNameFor,
  codexCommand,
  translateHooksForCodex,
} from "../src/build-hooks.js";

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

describe("codexEventNameFor", () => {
  it("passes through events Codex supports under the same name", () => {
    for (const e of ["Stop", "PreToolUse", "PostToolUse", "SessionStart", "UserPromptSubmit", "SubagentStop"]) {
      expect(codexEventNameFor(e)).toBe(e);
    }
  });

  it("returns null for events Codex lacks (negative)", () => {
    for (const e of ["SessionEnd", "Notification", "BeforeTool", "Bogus"]) {
      expect(codexEventNameFor(e)).toBeNull();
    }
  });
});

describe("codexCommand", () => {
  it("rewrites CLAUDE_PLUGIN_ROOT to PLUGIN_ROOT in both ${} and $ forms", () => {
    expect(codexCommand('node "${CLAUDE_PLUGIN_ROOT}/x.mjs" tick')).toBe('node "${PLUGIN_ROOT}/x.mjs" tick');
    expect(codexCommand("sh $CLAUDE_PLUGIN_ROOT/x.sh")).toBe("sh $PLUGIN_ROOT/x.sh");
  });

  it("leaves other commands unchanged (negative)", () => {
    expect(codexCommand("echo hi")).toBe("echo hi");
  });
});

describe("translateHooksForCodex", () => {
  it("keeps the Stop event name and rewrites the command to PLUGIN_ROOT", () => {
    const out = translateHooksForCodex({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/s.mjs" tick' }] }],
      },
    });
    expect(out.hooks).toHaveProperty("Stop");
    expect(out.hooks?.["Stop"]?.[0]?.hooks?.[0]?.command).toBe('node "${PLUGIN_ROOT}/s.mjs" tick');
  });

  it("translates Write/Edit matchers to apply_patch", () => {
    const out = translateHooksForCodex({
      hooks: { PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "x" }] }] },
    });
    expect(out.hooks?.["PostToolUse"]?.[0]?.matcher).toBe("apply_patch");
  });

  it("omits events Codex lacks and warns (negative)", () => {
    const warnings: string[] = [];
    const out = translateHooksForCodex(
      {
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "keep" }] }],
          SessionEnd: [{ hooks: [{ type: "command", command: "drop" }] }],
        },
      },
      (m) => warnings.push(m),
    );
    expect(out.hooks).toHaveProperty("Stop");
    expect(out.hooks).not.toHaveProperty("SessionEnd");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("SessionEnd");
  });

  it("does not mutate the source object", () => {
    const source = { hooks: { Stop: [{ hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/x" }] }] } };
    translateHooksForCodex(source, () => {});
    expect(source.hooks.Stop[0]?.hooks?.[0]?.command).toBe("${CLAUDE_PLUGIN_ROOT}/x");
  });
});
