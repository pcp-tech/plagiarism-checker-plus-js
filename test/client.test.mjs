import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import PlagiarismCheckerPlus, {
  PlagiarismCheckerPlusError,
  ScanTimeoutError,
  ErrorCodes,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
} from "../src/index.mjs";

function mockFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    const headers = new Map(Object.entries(next.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      text: async () => (next.body === undefined ? "" : JSON.stringify(next.body)),
    };
  };
  return { fetch, calls };
}

test("createScan sends the key and body", async () => {
  const { fetch, calls } = mockFetch([{ status: 202, body: { id: "s1", status: "processing", wordCount: 60, wordsCharged: 120, tools: ["plagiarism", "ai_detect"] } }]);
  const client = new PlagiarismCheckerPlus({ apiKey: "pcp_test", fetch });
  const result = await client.createScan("text", ["plagiarism", "ai_detect"], "draft");
  assert.equal(result.id, "s1");
  assert.equal(calls[0].url, "https://app.plagiarismcheckerplus.com/api/public/v1/scans");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer pcp_test");
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: "text", tools: ["plagiarism", "ai_detect"], name: "draft" });
});

test("getScan and listScans pass query parameters", async () => {
  const { fetch, calls } = mockFetch([
    { status: 200, body: { id: "s1", status: "completed" } },
    { status: 200, body: { data: [], pagination: { page: 2, limit: 5, total: 0, totalPages: 0 } } },
  ]);
  const client = new PlagiarismCheckerPlus({ apiKey: "k", fetch });
  await client.getScan("s1", { includeText: true });
  await client.listScans({ page: 2, limit: 5 });
  assert.ok(calls[0].url.endsWith("/scans/s1?include_text=true"));
  assert.ok(calls[1].url.endsWith("/scans?page=2&limit=5"));
});

test("errors expose status, code and detail fields", async () => {
  const billingUrl = "https://app.plagiarismcheckerplus.com/developers/billing";
  const { fetch } = mockFetch([
    {
      status: 402,
      body: { error: { code: "trial_exhausted", message: "Your free API trial cannot cover this request.", wordsNeeded: 900, trialRemaining: 100, trialTotal: 2000, billingUrl } },
    },
  ]);
  const client = new PlagiarismCheckerPlus({ apiKey: "k", fetch });
  await assert.rejects(client.createScan("text", ["plagiarism"]), (error) => {
    assert.ok(error instanceof PlagiarismCheckerPlusError);
    assert.equal(error.status, 402);
    assert.equal(error.code, ErrorCodes.TRIAL_EXHAUSTED);
    assert.equal(error.body.error.billingUrl, billingUrl);
    return true;
  });
});

test("error code constants include the billing codes and keep the deprecated one", () => {
  assert.equal(ErrorCodes.INSUFFICIENT_WORDS, "insufficient_words");
  assert.equal(ErrorCodes.TRIAL_EXHAUSTED, "trial_exhausted");
  assert.equal(ErrorCodes.KEY_CAP_REACHED, "key_cap_reached");
  assert.equal(ErrorCodes.PLAN_REQUIRED, "plan_required");
});

test("verifyWebhookSignature accepts a valid signature and rejects bad ones", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", type: "scan.completed", createdAt: "2026-11-18T00:00:00Z", data: {} });
  const t = 1_800_000_000;
  const sign = (ts, payload, key = secret) => createHmac("sha256", key).update(`${ts}.${payload}`).digest("hex");
  const header = `t=${t},v1=${sign(t, body)}`;

  assert.equal(WEBHOOK_SIGNATURE_HEADER, "PCP-Signature");
  assert.equal(verifyWebhookSignature(secret, header, body, { now: t + 10 }), true);
  assert.equal(verifyWebhookSignature(secret, header, Buffer.from(body), { now: t }), true);
  // Several v1 entries (secret rotation): any match passes.
  assert.equal(verifyWebhookSignature(secret, `t=${t},v1=${sign(t, body, "other")},v1=${sign(t, body)}`, body, { now: t }), true);

  assert.equal(verifyWebhookSignature("whsec_wrong", header, body, { now: t }), false);
  assert.equal(verifyWebhookSignature(secret, header, body + " ", { now: t }), false);
  assert.equal(verifyWebhookSignature(secret, header, body, { now: t + 301 }), false);
  assert.equal(verifyWebhookSignature(secret, header, body, { now: t - 301 }), false);
  assert.equal(verifyWebhookSignature(secret, header, body, { now: t + 500, tolerance: 600 }), true);
  assert.equal(verifyWebhookSignature(secret, `v1=${sign(t, body)}`, body, { now: t }), false);
  assert.equal(verifyWebhookSignature(secret, `t=${t}`, body, { now: t }), false);
  assert.equal(verifyWebhookSignature(secret, `t=${t},v1=abc`, body, { now: t }), false);
  assert.equal(verifyWebhookSignature(secret, null, body, { now: t }), false);
});

test("waitForScan backs off and honours Retry-After", async () => {
  const { fetch } = mockFetch([
    { status: 200, body: { id: "s1", status: "processing" } },
    { status: 429, headers: { "Retry-After": "3" }, body: { error: { code: "rate_limited", message: "Slow down" } } },
    { status: 200, body: { id: "s1", status: "completed" } },
  ]);
  const waits = [];
  const client = new PlagiarismCheckerPlus({ apiKey: "k", fetch });
  const scan = await client.waitForScan("s1", { interval: 1000, sleep: async (ms) => waits.push(ms) });
  assert.equal(scan.status, "completed");
  assert.deepEqual(waits, [1000, 3000]);
});

test("waitForScan times out", async () => {
  const { fetch } = mockFetch([{ status: 200, body: { id: "s1", status: "processing" } }]);
  const client = new PlagiarismCheckerPlus({ apiKey: "k", fetch });
  await assert.rejects(client.waitForScan("s1", { timeout: 10, interval: 1000, sleep: async () => {} }), ScanTimeoutError);
});

test("CommonJS entry exports the same client", () => {
  const require = createRequire(import.meta.url);
  const cjs = require("../src/index.cjs");
  assert.equal(typeof cjs.PlagiarismCheckerPlus, "function");
});
