/**
 * Tests for the deterministic dream-scheduling gate.
 *
 * Uses a temp DREAM_HOME and fixed ISO date constants — no Date.now()/new Date()
 * in test data; the clock is injected via the `now` option.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveStateDir,
  resolveIntervalHours,
  getLastDreamTime,
  shouldDream,
  isPending,
  dropPendingFlag,
  clearPendingFlag,
  recordDream,
  readStatus,
  runCli,
} from "../skills/dream/scripts/should-dream.mjs";

// Fixed clock constants (deterministic).
const T0 = new Date("2026-01-15T10:00:00.000Z");
const T_23H = new Date("2026-01-16T09:00:00.000Z"); // 23h after T0
const T_24H = new Date("2026-01-16T10:00:00.000Z"); // exactly 24h after T0
const T_25H = new Date("2026-01-16T11:00:00.000Z"); // 25h after T0

/** @type {string} */
let stateDir;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "dream-state-"));
  process.env["DREAM_HOME"] = stateDir;
  delete process.env["DREAM_INTERVAL_HOURS"];
});

afterEach(() => {
  delete process.env["DREAM_HOME"];
  delete process.env["DREAM_INTERVAL_HOURS"];
  rmSync(stateDir, { recursive: true, force: true });
});

describe("resolveStateDir / resolveIntervalHours", () => {
  it("honors DREAM_HOME override", () => {
    expect(resolveStateDir()).toBe(stateDir);
  });

  it("defaults the interval to 24h and honors DREAM_INTERVAL_HOURS", () => {
    expect(resolveIntervalHours()).toBe(24);
    process.env["DREAM_INTERVAL_HOURS"] = "6";
    expect(resolveIntervalHours()).toBe(6);
  });

  it("falls back to 24h on an invalid interval (negative)", () => {
    process.env["DREAM_INTERVAL_HOURS"] = "not-a-number";
    expect(resolveIntervalHours()).toBe(24);
    process.env["DREAM_INTERVAL_HOURS"] = "0";
    expect(resolveIntervalHours()).toBe(24);
  });
});

describe("shouldDream", () => {
  it("is due when no dream has ever run", () => {
    expect(getLastDreamTime(stateDir)).toBeNull();
    expect(shouldDream(stateDir, { now: T0 })).toBe(true);
  });

  it("is NOT due before the interval elapses", () => {
    recordDream(stateDir, { now: T0 });
    expect(shouldDream(stateDir, { now: T_23H })).toBe(false);
  });

  it("is due exactly at the interval boundary (>=)", () => {
    recordDream(stateDir, { now: T0 });
    expect(shouldDream(stateDir, { now: T_24H })).toBe(true);
  });

  it("is due after the interval elapses", () => {
    recordDream(stateDir, { now: T0 });
    expect(shouldDream(stateDir, { now: T_25H })).toBe(true);
  });

  it("respects a custom interval", () => {
    recordDream(stateDir, { now: T0 });
    expect(shouldDream(stateDir, { now: T_23H, intervalHours: 12 })).toBe(true);
  });

  it("treats a malformed .dream-last as never-dreamt (negative)", () => {
    writeFileSync(join(stateDir, ".dream-last"), "not-a-date", "utf8");
    expect(getLastDreamTime(stateDir)).toBeNull();
    expect(shouldDream(stateDir, { now: T0 })).toBe(true);
  });
});

describe("pending flag lifecycle", () => {
  it("dropPendingFlag creates the flag; isPending reflects it; clear removes it", () => {
    expect(isPending(stateDir)).toBe(false);
    const path = dropPendingFlag(stateDir, { now: T0 });
    expect(path).toBe(join(stateDir, ".dream-pending"));
    expect(isPending(stateDir)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain(T0.toISOString());
    clearPendingFlag(stateDir);
    expect(isPending(stateDir)).toBe(false);
  });

  it("clearPendingFlag is idempotent when no flag exists (negative)", () => {
    expect(() => {
      clearPendingFlag(stateDir);
    }).not.toThrow();
  });

  it("recordDream stamps .dream-last and clears the pending flag", () => {
    dropPendingFlag(stateDir, { now: T0 });
    expect(isPending(stateDir)).toBe(true);
    const iso = recordDream(stateDir, { now: T_24H });
    expect(iso).toBe(T_24H.toISOString());
    expect(getLastDreamTime(stateDir)?.toISOString()).toBe(T_24H.toISOString());
    expect(isPending(stateDir)).toBe(false);
  });
});

describe("readStatus", () => {
  it("reports never-dreamt state", () => {
    expect(readStatus(stateDir, { now: T0 })).toEqual({
      due: true,
      pending: false,
      lastDream: null,
      intervalHours: 24,
    });
  });

  it("reports not-due-with-recent-dream state", () => {
    recordDream(stateDir, { now: T0 });
    expect(readStatus(stateDir, { now: T_23H })).toEqual({
      due: false,
      pending: false,
      lastDream: T0.toISOString(),
      intervalHours: 24,
    });
  });
});

describe("runCli", () => {
  /** @returns {{ out: string, code: number }} */
  function invoke(args) {
    let out = "";
    const code = runCli(args, (s) => {
      out += s;
    });
    return { out, code };
  }

  it("tick queues a dream when due, and is a no-op when not", () => {
    // Due (never dreamt) → queues.
    expect(invoke(["tick"]).code).toBe(0);
    expect(isPending(stateDir)).toBe(true);

    // Record now → not due → tick is a no-op (but a stale pending flag stays until consumed).
    clearPendingFlag(stateDir);
    recordDream(stateDir);
    const { out } = invoke(["tick"]);
    expect(out).toBe("");
    expect(isPending(stateDir)).toBe(false);
  });

  it("status --json emits the snapshot shape", () => {
    const { out, code } = invoke(["status", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({ due: true, pending: false, lastDream: null, intervalHours: 24 });
  });

  it("record writes the timestamp; clear removes the flag", () => {
    dropPendingFlag(stateDir);
    expect(invoke(["record"]).code).toBe(0);
    expect(getLastDreamTime(stateDir)).not.toBeNull();
    expect(isPending(stateDir)).toBe(false);

    dropPendingFlag(stateDir);
    expect(invoke(["clear"]).code).toBe(0);
    expect(isPending(stateDir)).toBe(false);
  });

  it("returns exit code 2 on an unknown command (negative)", () => {
    expect(invoke(["bogus"]).code).toBe(2);
    expect(invoke([]).code).toBe(2);
  });
});
