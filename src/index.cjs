"use strict";

// Client for the Plagiarism Checker Plus public API (spec/openapi.json in this repository).

const DEFAULT_BASE_URL = "https://app.plagiarismcheckerplus.com/api/public/v1";
const VERSION = "1.1.0";

/** Header that carries the webhook signature. */
const WEBHOOK_SIGNATURE_HEADER = "PCP-Signature";
/** How old a signed webhook timestamp may be, in seconds, before it is rejected. */
const WEBHOOK_TOLERANCE_SECONDS = 300;

const ErrorCodes = Object.freeze({
  /** @deprecated No longer returned: free accounts get a free API trial and free test keys. */
  PLAN_REQUIRED: "plan_required",
  TEXT_TOO_SHORT: "text_too_short",
  DOC_TOO_LONG: "doc_too_long",
  /** 402: not enough words across all sources. Body has wordsNeeded, wordsAvailable, balances, billingUrl. */
  INSUFFICIENT_WORDS: "insufficient_words",
  /** 402: the free API trial cannot cover the request. Body has wordsNeeded, trialRemaining, trialTotal, billingUrl. */
  TRIAL_EXHAUSTED: "trial_exhausted",
  /** 402: the key's monthly word cap would be exceeded. Body has wordsNeeded, monthlyWordCap, usedThisMonth. */
  KEY_CAP_REACHED: "key_cap_reached",
  INVALID_REQUEST: "invalid_request",
  INVALID_JSON: "invalid_json",
  UNAUTHORIZED: "unauthorized",
  INVALID_API_KEY: "invalid_api_key",
  KEY_REVOKED: "key_revoked",
  EMAIL_UNVERIFIED: "email_unverified",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  RATE_LIMITED: "rate_limited",
  WORKERS_UNAVAILABLE: "workers_unavailable",
  INTERNAL_ERROR: "internal_error",
});

class PlagiarismCheckerPlusError extends Error {
  constructor(message, { status = 0, code = null, retryAfter = null, body = null } = {}) {
    super(message);
    this.name = "PlagiarismCheckerPlusError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

class ScanTimeoutError extends Error {
  constructor(scanId, timeoutMs) {
    super(`Scan ${scanId} did not finish within ${timeoutMs} ms`);
    this.name = "ScanTimeoutError";
    this.scanId = scanId;
  }
}

/** Seconds from a Retry-After header (delta-seconds or HTTP date), or null. */
function parseRetryAfter(value) {
  if (value == null || value === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, (date - Date.now()) / 1000);
}

/**
 * Check a webhook's PCP-Signature header against the raw request body.
 *
 * The header is `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 * Pass the body exactly as received (string or bytes), before any JSON parsing.
 * Returns false for a missing or malformed header, a wrong signature, or a
 * timestamp more than `tolerance` seconds from now. Uses node:crypto, so it
 * runs in Node.js, Bun and Deno.
 *
 * @param {string} secret The endpoint's signing secret (whsec_...).
 * @param {string | null | undefined} header The PCP-Signature header value.
 * @param {string | Uint8Array} body The raw request body.
 * @param {{ tolerance?: number, now?: number }} [options] tolerance in seconds (default 300); now in unix seconds.
 * @returns {boolean}
 */
function verifyWebhookSignature(secret, header, body, { tolerance = WEBHOOK_TOLERANCE_SECONDS, now } = {}) {
  if (!secret || !header || body === undefined || body === null) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of String(header).split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-fA-F]+$/.test(value)) signatures.push(value.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) return false;
  const nowSeconds = now === undefined ? Math.floor(Date.now() / 1000) : now;
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;
  const crypto = require("node:crypto");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(typeof body === "string" ? body : Buffer.from(body))
    .digest();
  return signatures.some((signature) => {
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class PlagiarismCheckerPlus {
  /**
   * @param {object} options
   * @param {string} options.apiKey Your API key (pcp_...).
   * @param {string} [options.baseUrl]
   * @param {typeof fetch} [options.fetch] Custom fetch, for tests or proxies.
   */
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl } = {}) {
    if (!apiKey) throw new TypeError("apiKey is required");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetchImpl || globalThis.fetch;
    if (typeof this.fetch !== "function") throw new TypeError("fetch is not available; pass options.fetch");
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": `plagiarism-checker-plus-js/${VERSION}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await this.fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const error = (data && data.error) || {};
      throw new PlagiarismCheckerPlusError(error.message || `HTTP ${response.status}`, {
        status: response.status,
        code: error.code || null,
        retryAfter: parseRetryAfter(response.headers.get("retry-after")),
        body: data,
      });
    }
    return data;
  }

  /** Submit text. tools: array of "plagiarism" and/or "ai_detect". Returns 202 body. */
  createScan(text, tools, name) {
    const body = { text, tools };
    if (name !== undefined) body.name = name;
    return this.request("POST", "/scans", { body });
  }

  /** Read a scan and its results. */
  getScan(id, { includeText = false } = {}) {
    return this.request("GET", `/scans/${encodeURIComponent(id)}`, {
      query: includeText ? { include_text: "true" } : undefined,
    });
  }

  /** List scans, newest first. */
  listScans({ page, limit } = {}) {
    return this.request("GET", "/scans", { query: { page, limit } });
  }

  /** Plan, word balances, free API trial, auto top-up and this key's mode and cap. */
  getAccount() {
    return this.request("GET", "/account");
  }

  /**
   * Poll until the scan is completed or failed. Waits interval ms, growing by
   * 1.5x up to maxInterval; on 429 waits for Retry-After instead.
   */
  async waitForScan(id, { timeout = 300_000, interval = 2_000, maxInterval = 10_000, includeText = false, sleep: sleepFn = sleep } = {}) {
    const deadline = Date.now() + timeout;
    let delay = interval;
    for (;;) {
      let wait = delay;
      try {
        const scan = await this.getScan(id, { includeText });
        if (scan.status === "completed" || scan.status === "failed") return scan;
        delay = Math.min(Math.round(delay * 1.5), maxInterval);
      } catch (error) {
        if (!(error instanceof PlagiarismCheckerPlusError) || error.status !== 429) throw error;
        wait = error.retryAfter != null ? error.retryAfter * 1000 : delay;
      }
      if (Date.now() + wait > deadline) throw new ScanTimeoutError(id, timeout);
      await sleepFn(wait);
    }
  }
}

module.exports = {
  PlagiarismCheckerPlus,
  PlagiarismCheckerPlusError,
  ScanTimeoutError,
  ErrorCodes,
  DEFAULT_BASE_URL,
  parseRetryAfter,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
  // Lets `require("plagiarism-checker-plus").default` match the default export in index.d.ts.
  default: PlagiarismCheckerPlus,
};
