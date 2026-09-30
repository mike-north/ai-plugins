/**
 * Unit tests for the dependency-free TypeSafe System One HTTP client used by the
 * merge gate. The client must send the documented request shape, retry only the
 * documented transient statuses, and reject any response that is not a complete,
 * well-typed answer set — the gate fails closed on every error it raises.
 *
 * @see https://docs.typesafe.ai/api.md
 * @see https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy.md
 */
import { describe, it, expect } from "vitest";
import { createSystemOneClient, resolveEndpoint, DEFAULT_BASE_URL, TypeSafeRequestError } from "./typesafe-client.mjs";

const QUESTIONS = {
  addresses: { type: "choice", instructions: "Which?", criteria: { a: "A", b: "B" } },
  beyond: { type: "noul", instructions: "Beyond?" },
};

const GOOD = {
  model: "jev-1.13.0",
  answers: {
    addresses: { type: "choice", choice: "a", probabilities: { a: 0.8, b: 0.2 }, confidence: 0.7 },
    beyond: { type: "noul", noul: 0.1 },
  },
  usage: { input_tokens: 10, output_tokens: 0 },
};

/** A fetch double that replays `responses` in order and records each call. */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
      status: next.status,
    });
  };
  return { impl, calls };
}

const client = (fetchImpl, extra = {}) =>
  createSystemOneClient({
    apiKey: "test-key",
    baseUrl: "https://api.example.test",
    model: "jev-1.13.0",
    fetch: fetchImpl,
    sleep: async () => {},
    ...extra,
  });

describe("createSystemOneClient", () => {
  it("POSTs the documented shape to /v1/systemone with a bearer key", async () => {
    const f = fakeFetch([{ status: 200, body: GOOD }]);
    const answers = await client(f.impl).ask({ state: { x: 1 }, questions: QUESTIONS });
    expect(answers).toEqual(GOOD.answers);
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0];
    expect(url).toBe("https://api.example.test/v1/systemone");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      model: "jev-1.13.0",
      state: { x: 1 },
      questions: QUESTIONS,
    });
  });

  it("refuses to construct without an API key", () => {
    expect(() => client(fakeFetch([]).impl, { apiKey: "" })).toThrow(TypeSafeRequestError);
  });

  it("retries transient 529/429/5xx then succeeds", async () => {
    const f = fakeFetch([
      { status: 529, body: "overloaded" },
      { status: 429, body: "slow down" },
      { status: 200, body: GOOD },
    ]);
    const answers = await client(f.impl, { maxRetries: 2 }).ask({ state: "s", questions: QUESTIONS });
    expect(answers.beyond.noul).toBe(0.1);
    expect(f.calls).toHaveLength(3);
  });

  it("gives up after maxRetries on persistent 5xx", async () => {
    const f = fakeFetch([{ status: 500, body: "boom" }]);
    await expect(client(f.impl, { maxRetries: 2 }).ask({ state: "s", questions: QUESTIONS })).rejects.toThrow(
      /500/,
    );
    expect(f.calls).toHaveLength(3);
  });

  it("does not retry 401 and names the key as the likely cause", async () => {
    const f = fakeFetch([{ status: 401, body: "bad key" }]);
    const err = await client(f.impl).ask({ state: "s", questions: QUESTIONS }).catch((e) => e);
    expect(err).toBeInstanceOf(TypeSafeRequestError);
    expect(err.message).toMatch(/TYPESAFE_API_KEY/);
    expect(f.calls).toHaveLength(1);
  });

  it("does not retry 422 (the request itself is invalid)", async () => {
    const f = fakeFetch([{ status: 422, body: '{"detail":"bad"}' }]);
    await expect(client(f.impl).ask({ state: "s", questions: QUESTIONS })).rejects.toThrow(/422/);
    expect(f.calls).toHaveLength(1);
  });

  it("retries network errors, then reports them", async () => {
    const f = fakeFetch([new TypeError("fetch failed")]);
    await expect(client(f.impl, { maxRetries: 1 }).ask({ state: "s", questions: QUESTIONS })).rejects.toThrow(
      /network/i,
    );
    expect(f.calls).toHaveLength(2);
  });

  it("never includes the API key in an error message", async () => {
    const f = fakeFetch([{ status: 401, body: "bad key test-key" }]);
    const err = await client(f.impl).ask({ state: "s", questions: QUESTIONS }).catch((e) => e);
    expect(err.message).not.toContain("test-key");
  });

  describe("rejects incomplete or ill-typed answers (fail closed)", () => {
    const bad = async (answers) => {
      const f = fakeFetch([{ status: 200, body: { ...GOOD, answers } }]);
      return client(f.impl).ask({ state: "s", questions: QUESTIONS });
    };

    it("a missing answer", async () => {
      await expect(bad({ addresses: GOOD.answers.addresses })).rejects.toThrow(/beyond/);
    });

    it("a wrong answer type", async () => {
      await expect(
        bad({ ...GOOD.answers, beyond: { type: "choice", choice: "a", probabilities: {}, confidence: 1 } }),
      ).rejects.toThrow(/beyond/);
    });

    it("a noul outside [0, 1]", async () => {
      await expect(bad({ ...GOOD.answers, beyond: { type: "noul", noul: 1.5 } })).rejects.toThrow(/beyond/);
    });

    it("a choice not among the offered options", async () => {
      await expect(
        bad({
          ...GOOD.answers,
          addresses: { type: "choice", choice: "zzz", probabilities: { a: 1 }, confidence: 1 },
        }),
      ).rejects.toThrow(/addresses/);
    });

    it("a non-JSON body", async () => {
      const f = fakeFetch([{ status: 200, body: "<html>" }]);
      await expect(client(f.impl).ask({ state: "s", questions: QUESTIONS })).rejects.toThrow(/JSON/);
    });
  });
});

describe("resolveEndpoint — a non-default endpoint could fake the judgement, so only loopback is honoured", () => {
  it("defaults to the TypeSafe API without a warning", () => {
    expect(DEFAULT_BASE_URL).toBe("https://api.typesafe.ai");
    expect(resolveEndpoint(undefined)).toEqual({ baseUrl: DEFAULT_BASE_URL, warning: undefined });
    expect(resolveEndpoint("")).toEqual({ baseUrl: DEFAULT_BASE_URL, warning: undefined });
    expect(resolveEndpoint("https://api.typesafe.ai/")).toEqual({ baseUrl: DEFAULT_BASE_URL, warning: undefined });
  });

  it("honours loopback hosts, with a loud warning", () => {
    for (const url of ["http://127.0.0.1:8080", "http://localhost:3000", "http://[::1]:9000"]) {
      const r = resolveEndpoint(url);
      expect(r.baseUrl).toBe(url);
      expect(r.warning).toMatch(/^WARNING: non-default TypeSafe endpoint/);
      expect(r.warning).toContain(url);
    }
  });

  it("refuses every other endpoint", () => {
    for (const url of [
      "https://api.typesafe.ai.example.test",
      "https://judge.example.test",
      "http://127.0.0.2:80",
      "http://localhost@evil.example.test",
      "ftp://localhost/",
      "not a url",
    ]) {
      expect(() => resolveEndpoint(url), url).toThrow(/TYPESAFE_BASE_URL/);
    }
  });
});
