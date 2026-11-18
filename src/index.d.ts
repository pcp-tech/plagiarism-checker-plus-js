export type Tool = "plagiarism" | "ai_detect";
export type ScanStatus = "pending" | "processing" | "completed" | "failed";

export interface ScanSummary {
  id: string;
  name: string | null;
  status: ScanStatus;
  /** Words in the submitted text. */
  wordCount: number;
  /** Words billed: wordCount × number of tools. */
  wordsCharged: number;
  tools: Tool[];
  createdAt: string;
  completedAt: string | null;
  /** True for scans made with a test key (pcp_test_...): fixed sample results, nothing checked or charged. */
  sandbox?: boolean;
}

export interface PlagiarismSource {
  url: string;
  domain: string;
  matchPercentage: number;
  /** The passage from your text that matched. */
  matchedText: string;
  /** Surrounding text from the source page. */
  excerpt: string | null;
}

export interface AiSentence {
  text: string;
  /** 0–1 likelihood the sentence is AI-generated. A likelihood, not proof. */
  probability: number;
  offset: number;
  length: number;
}

export interface ScanDetail extends ScanSummary {
  /** Only present when includeText is true. */
  text?: string;
  progress?: { percent: number; tools: { tool: string; status: string; percent: number }[] };
  /** Populated as each tool finishes; null until then. */
  results?: {
    plagiarism?: { score: number; uniqueSources: number; sources: PlagiarismSource[] } | null;
    aiDetection?: { score: number; summary: string | null; sentences: AiSentence[] } | null;
  };
}

export interface CreateScanResponse {
  id: string;
  status: string;
  wordCount: number;
  wordsCharged: number;
  tools: string[];
  /** True when the scan was made with a test key. */
  sandbox?: boolean;
}

export interface ScanList {
  data: ScanSummary[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/** The one-time free API trial (2,000 words) for free accounts. */
export interface AccountTrial {
  wordsTotal: number;
  wordsUsed: number;
  wordsRemaining: number;
}

/** What live API requests can draw on, in the order they are charged. */
export interface AccountBalances {
  apiPlan: {
    plan: string;
    name: string;
    status: string;
    wordsLimit: number;
    wordsUsed: number;
    wordsRemaining: number;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  appPlan: { plan: string; monthlyRemaining: number; bonusBalance: number } | null;
  purchasedWords: number;
  trialRemaining: number;
  totalAvailable: number;
}

export interface AccountAutoTopup {
  enabled: boolean;
  thresholdWords: number | null;
  topupWords: number | null;
  monthlyCapUsd: number | null;
  spentThisMonthUsd: number;
  lastStatus: string | null;
}

export interface Account {
  id: string;
  email: string;
  plan: string;
  /** App plan words. */
  words: { monthlyLimit: number; monthlyUsed: number; monthlyRemaining: number; bonusBalance: number };
  /** The free API trial; null on paid app plans, which never use it. */
  trial?: AccountTrial | null;
  balances?: AccountBalances;
  autoTopup?: AccountAutoTopup;
  /** The calling key: "live" or "test", its monthly word cap (null for none) and words it used this month. */
  key?: { mode: "live" | "test" | string; monthlyWordCap: number | null; wordsUsedThisMonth: number };
  /** Where to buy API words or choose an API plan. */
  billingUrl?: string;
  limits: { maxDocumentWords: number | null; requestsPerMinute?: number };
  monthlyResetAt: string | null;
}

/** Extra fields on 402 errors (insufficient_words, trial_exhausted, key_cap_reached). Read them from error.body.error. */
export interface ApiErrorBody {
  code: string;
  message: string;
  wordsNeeded?: number;
  wordsAvailable?: number;
  balances?: {
    apiPlanRemaining?: number;
    appMonthlyRemaining?: number;
    appBonusBalance?: number;
    purchasedWords?: number;
    trialRemaining?: number;
  };
  billingUrl?: string;
  trialRemaining?: number;
  trialTotal?: number;
  monthlyWordCap?: number;
  usedThisMonth?: number;
  [key: string]: unknown;
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface WaitOptions {
  /** Total time to wait in ms. Default 300000. */
  timeout?: number;
  /** First poll delay in ms. Default 2000. */
  interval?: number;
  /** Largest poll delay in ms. Default 10000. */
  maxInterval?: number;
  includeText?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

export declare const DEFAULT_BASE_URL: string;
export declare const ErrorCodes: {
  /** @deprecated No longer returned: free accounts get a free API trial and free test keys. */
  readonly PLAN_REQUIRED: "plan_required";
  readonly TEXT_TOO_SHORT: "text_too_short";
  readonly DOC_TOO_LONG: "doc_too_long";
  readonly INSUFFICIENT_WORDS: "insufficient_words";
  readonly TRIAL_EXHAUSTED: "trial_exhausted";
  readonly KEY_CAP_REACHED: "key_cap_reached";
  readonly INVALID_REQUEST: "invalid_request";
  readonly INVALID_JSON: "invalid_json";
  readonly UNAUTHORIZED: "unauthorized";
  readonly INVALID_API_KEY: "invalid_api_key";
  readonly KEY_REVOKED: "key_revoked";
  readonly EMAIL_UNVERIFIED: "email_unverified";
  readonly FORBIDDEN: "forbidden";
  readonly NOT_FOUND: "not_found";
  readonly RATE_LIMITED: "rate_limited";
  readonly WORKERS_UNAVAILABLE: "workers_unavailable";
  readonly INTERNAL_ERROR: "internal_error";
};

export declare class PlagiarismCheckerPlusError extends Error {
  status: number;
  /** The API's error code, e.g. "insufficient_words". */
  code: string | null;
  /** Seconds from Retry-After, if sent. */
  retryAfter: number | null;
  /** The parsed response body: { error: ApiErrorBody } for API errors. */
  body: { error?: ApiErrorBody } | null;
}

export declare class ScanTimeoutError extends Error {
  scanId: string;
}

export declare function parseRetryAfter(value: string | null | undefined): number | null;

/** "PCP-Signature" */
export declare const WEBHOOK_SIGNATURE_HEADER: string;
/** 300 seconds. */
export declare const WEBHOOK_TOLERANCE_SECONDS: number;

/**
 * Check a webhook's PCP-Signature header (t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>)
 * against the raw request body, in constant time. Rejects timestamps more than `tolerance`
 * seconds (default 300) from `now` (unix seconds, default the current time). Node.js, Bun, Deno.
 */
export declare function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  body: string | Uint8Array,
  options?: { tolerance?: number; now?: number },
): boolean;

/** Body of a webhook delivery (scan.completed, scan.failed, webhook.test). */
export interface WebhookEvent {
  id: string;
  type: "scan.completed" | "scan.failed" | "webhook.test" | string;
  createdAt: string;
  data: {
    scan?: {
      id: string;
      name: string | null;
      status: "completed" | "partial" | "failed" | string;
      wordCount: number;
      wordsCharged: number;
      createdAt: string;
      completedAt: string | null;
      results: { tool: Tool; status: string; score: number | null }[];
    };
  };
}

export declare class PlagiarismCheckerPlus {
  constructor(options: ClientOptions);
  createScan(text: string, tools: Tool[], name?: string): Promise<CreateScanResponse>;
  getScan(id: string, options?: { includeText?: boolean }): Promise<ScanDetail>;
  listScans(options?: { page?: number; limit?: number }): Promise<ScanList>;
  getAccount(): Promise<Account>;
  waitForScan(id: string, options?: WaitOptions): Promise<ScanDetail>;
}

export default PlagiarismCheckerPlus;
