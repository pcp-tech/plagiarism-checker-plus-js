import sdk from "./index.cjs";

export const {
  PlagiarismCheckerPlus,
  PlagiarismCheckerPlusError,
  ScanTimeoutError,
  ErrorCodes,
  DEFAULT_BASE_URL,
  parseRetryAfter,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
} = sdk;
export default PlagiarismCheckerPlus;
