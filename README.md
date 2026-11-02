# Plagiarism Checker Plus for JavaScript and TypeScript

Official client for the [Plagiarism Checker Plus API](https://plagiarismcheckerplus.com/integrations/api). Works in Node.js 18+ and any runtime with `fetch`. No dependencies. Ships ESM, CommonJS and TypeScript types.

The API needs a paid plan. A key on the free plan returns `403 plan_required`.

```sh
npm install plagiarism-checker-plus
```

```js
import PlagiarismCheckerPlus, { PlagiarismCheckerPlusError, ErrorCodes } from "plagiarism-checker-plus";

const client = new PlagiarismCheckerPlus({ apiKey: process.env.PCP_API_KEY });

try {
  const { id } = await client.createScan(essayText, ["plagiarism", "ai_detect"], "essay-draft-1");
  const scan = await client.waitForScan(id);

  console.log("Matched:", scan.results.plagiarism?.score, "%");
  for (const source of scan.results.plagiarism?.sources ?? []) console.log(source.url);

  // A likelihood, not proof that the text was written by AI.
  console.log("AI likelihood:", scan.results.aiDetection?.score, "%");
} catch (error) {
  if (error instanceof PlagiarismCheckerPlusError && error.code === ErrorCodes.TEXT_TOO_SHORT) {
    console.error("Send at least 30 words for plagiarism, 50 for AI detection.");
  } else {
    throw error;
  }
}
```

CommonJS: `const { PlagiarismCheckerPlus } = require("plagiarism-checker-plus");`

## Methods

| Method | API call |
|---|---|
| `createScan(text, tools, name?)` | `POST /scans` |
| `getScan(id, { includeText })` | `GET /scans/{id}` |
| `listScans({ page, limit })` | `GET /scans` |
| `getAccount()` | `GET /account` |
| `waitForScan(id, { timeout, interval, maxInterval })` | Polls `GET /scans/{id}` until `completed` or `failed` |

`waitForScan` starts at 2 seconds between polls, grows by 1.5× up to 10 seconds, waits for `Retry-After` on `429`, and throws `ScanTimeoutError` after 5 minutes by default.

Failed calls throw `PlagiarismCheckerPlusError` with `status`, `code` (such as `plan_required`, `text_too_short`, `doc_too_long`, `insufficient_words`) and `retryAfter`.

Each tool is billed at the full word count. The rate limit is 60 requests a minute per key.

## Error handling

Failed calls raise `PlagiarismCheckerPlusError`. It carries the HTTP status and the API error code:

| Code | Status | Meaning |
|---|---|---|
| `plan_required` | 403 | The key's plan has no API access. The API needs a paid plan. |
| `text_too_short` | 400 | Plagiarism needs at least 30 words, AI detection at least 50. Nothing is charged. |
| `doc_too_long` | 400 | The text is longer than the plan allows per check. |
| `insufficient_words` | 402 | Not enough words left on the account. |

Other codes (for example on `401`, `404`, `429` or `503`) come through as the raw string the API sends. On `429` the client honours `Retry-After`. `waitForScan` raises `ScanTimeoutError` when it runs out of time. A scan whose status is `failed` is returned, not raised, so check `status`.

## Notes

- **An AI score is a likelihood, not proof** that someone used AI. A similarity score does not decide on its own whether text is plagiarism. Review the result yourself, and do not use either score alone to accuse anyone.
- **The API needs a paid plan.** A key on the free plan returns `403 plan_required`.
- Each tool you run is billed at the full word count. The rate limit is 60 requests a minute per key.
- API documentation: https://plagiarismcheckerplus.com/integrations/api
- The OpenAPI spec this client follows is in [`spec/openapi.json`](spec/openapi.json).

## Other languages

| Language | Repository | Install |
|---|---|---|
| **JavaScript / TypeScript** (this repository) | [plagiarism-checker-plus-js](https://github.com/pcp-tech/plagiarism-checker-plus-js) | `npm install plagiarism-checker-plus` |
| Python | [plagiarism-checker-plus-python](https://github.com/pcp-tech/plagiarism-checker-plus-python) | `pip install plagiarism-checker-plus` |
| PHP | [plagiarism-checker-plus-php](https://github.com/pcp-tech/plagiarism-checker-plus-php) | `composer require plagiarismcheckerplus/sdk` |
| Ruby | [plagiarism-checker-plus-ruby](https://github.com/pcp-tech/plagiarism-checker-plus-ruby) | `gem install plagiarism_checker_plus` |
| Go | [plagiarism-checker-plus-go](https://github.com/pcp-tech/plagiarism-checker-plus-go) | `go get github.com/pcp-tech/plagiarism-checker-plus-go` |
| Java | [plagiarism-checker-plus-java](https://github.com/pcp-tech/plagiarism-checker-plus-java) | Maven `com.plagiarismcheckerplus:sdk` |
| C# / .NET | [plagiarism-checker-plus-dotnet](https://github.com/pcp-tech/plagiarism-checker-plus-dotnet) | `dotnet add package PlagiarismCheckerPlus` |

## License

MIT. Copyright (c) 2026 Plagiarism Checker Plus.
