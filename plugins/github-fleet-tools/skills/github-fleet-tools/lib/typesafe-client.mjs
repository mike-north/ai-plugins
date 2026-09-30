// @ts-check
/**
 * Minimal, dependency-free client for TypeSafe's System One HTTP endpoint.
 *
 * The plugin ships plain source with no install step, so it cannot depend on
 * `@typesafe-ai/sdk`; this module speaks the documented HTTP contract directly
 * (`POST {base}/v1/systemone`, bearer auth) and mirrors the SDK's retry policy
 * (retry 408/429/5xx and connection failures with capped exponential backoff).
 *
 * Its contract with callers is strict: `ask()` resolves ONLY with a complete
 * answer set whose every answer has the type and value range its question
 * implies. Anything else — a missing key, an HTTP error, a malformed or partial
 * body — rejects with a `TypeSafeRequestError`, so a caller that gates an action
 * on the answers fails closed by construction. Error messages never contain the
 * API key.
 *
 * @see https://docs.typesafe.ai/api.md
 * @see https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy.md
 */

/** Raised for every failure to obtain a complete, well-typed answer set. */
export class TypeSafeRequestError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "TypeSafeRequestError";
  }
}

/** Statuses the SDK treats as transient and retries. */
const isRetryableStatus = (/** @type {number} */ s) => s === 408 || s === 429 || (s >= 500 && s <= 599);

/**
 * @typedef {{ type: "choice", instructions: unknown, criteria: Record<string, unknown> }} ChoiceQuestion
 * @typedef {{ type: "noul", instructions: unknown, criteria?: unknown }} NoulQuestion
 * @typedef {ChoiceQuestion | NoulQuestion} Question
 * @typedef {{ type: "choice", choice: string, probabilities: Record<string, number>, confidence: number }} ChoiceAnswer
 * @typedef {{ type: "noul", noul: number }} NoulAnswer
 * @typedef {ChoiceAnswer | NoulAnswer} Answer
 *
 * @typedef {object} ClientOptions
 * @property {string | undefined} apiKey   bearer key; required
 * @property {string} [baseUrl]            API root (default https://api.typesafe.ai)
 * @property {string} model                model id, pinned by the caller
 * @property {number} [maxRetries]         retries after the first attempt (default 2)
 * @property {number} [timeoutMs]          per-attempt timeout (default 30000)
 * @property {typeof fetch} [fetch]        injectable for tests
 * @property {(ms: number) => Promise<void>} [sleep] injectable for tests
 */

/**
 * @param {ClientOptions} opts
 * @returns {{ model: string, ask: (req: { state: unknown, questions: Record<string, Question> }) => Promise<Record<string, Answer>> }}
 */
export function createSystemOneClient(opts) {
  const apiKey = opts.apiKey ?? "";
  if (!apiKey) throw new TypeSafeRequestError("TYPESAFE_API_KEY is not set");
  const baseUrl = (opts.baseUrl || "https://api.typesafe.ai").replace(/\/+$/, "");
  const maxRetries = opts.maxRetries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const redact = (/** @type {string} */ s) => s.split(apiKey).join("[redacted]");

  /** Backoff before retry `n` (0-based): 500ms doubling, capped at 5s, 25% jitter. */
  const backoff = (/** @type {number} */ n) => {
    const base = Math.min(500 * 2 ** n, 5000);
    return base - Math.random() * base * 0.25;
  };

  return {
    model: opts.model,
    async ask({ state, questions }) {
      const body = JSON.stringify({ model: opts.model, state, questions });
      /** @type {string} */
      let lastProblem = "no attempt made";
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) await sleep(backoff(attempt - 1));
        /** @type {Response} */
        let res;
        try {
          res = await doFetch(`${baseUrl}/v1/systemone`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (err) {
          lastProblem = `network error contacting TypeSafe: ${redact(String(err instanceof Error ? err.message : err))}`;
          continue;
        }
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          const detail = redact(text.slice(0, 200)).trim();
          lastProblem = `TypeSafe returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
          if (res.status === 401 || res.status === 403) {
            throw new TypeSafeRequestError(`${lastProblem} (check that TYPESAFE_API_KEY holds a valid key)`);
          }
          if (isRetryableStatus(res.status)) continue;
          throw new TypeSafeRequestError(lastProblem);
        }
        /** @type {unknown} */
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new TypeSafeRequestError("TypeSafe returned a response that is not JSON");
        }
        return validateAnswers(parsed, questions);
      }
      throw new TypeSafeRequestError(`${lastProblem} (gave up after ${maxRetries + 1} attempts)`);
    },
  };
}

const isProbability = (/** @type {unknown} */ v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Check that `body.answers` holds exactly-typed answers for every question.
 * @param {unknown} body
 * @param {Record<string, Question>} questions
 * @returns {Record<string, Answer>}
 */
function validateAnswers(body, questions) {
  const answers =
    body && typeof body === "object" && "answers" in body && body.answers && typeof body.answers === "object"
      ? /** @type {Record<string, any>} */ (body.answers)
      : null;
  if (!answers) throw new TypeSafeRequestError("TypeSafe response has no answers object");
  /** @type {Record<string, Answer>} */
  const out = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = answers[id];
    const bad = (/** @type {string} */ why) => new TypeSafeRequestError(`TypeSafe answer "${id}" is unusable: ${why}`);
    if (!a || typeof a !== "object") throw bad("missing");
    if (a.type !== q.type) throw bad(`expected type ${q.type}, got ${String(a.type)}`);
    if (q.type === "noul") {
      if (!isProbability(a.noul)) throw bad("noul is not a probability in [0, 1]");
      out[id] = { type: "noul", noul: a.noul };
    } else {
      const options = Object.keys(q.criteria);
      if (typeof a.choice !== "string" || !options.includes(a.choice)) throw bad("choice is not an offered option");
      if (!isProbability(a.confidence)) throw bad("confidence is not in [0, 1]");
      if (!a.probabilities || typeof a.probabilities !== "object") throw bad("probabilities missing");
      /** @type {Record<string, number>} */
      const probabilities = {};
      for (const [k, v] of Object.entries(a.probabilities)) {
        if (!options.includes(k) || !isProbability(v)) throw bad(`probability for "${k}" is invalid`);
        probabilities[k] = /** @type {number} */ (v);
      }
      out[id] = { type: "choice", choice: a.choice, probabilities, confidence: a.confidence };
    }
  }
  return out;
}
