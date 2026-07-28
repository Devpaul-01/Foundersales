// src/utils/providerErrors.js
// ============================================================
// PROVIDER ERROR CLASSIFICATION — Phase 2 refactor (H8)
//
// Replaces multiProvider.js's previous string-substring-matching
// classification (isRetryableError / shouldCoolKey — matching fragments
// like '429', '500', 'unauthorized' against a re-formatted error MESSAGE
// string) with a structured, status-code-driven taxonomy.
//
// The old approach had two distinct problems, not one:
//   1. Under-inclusive: a 400 Bad Request (e.g. a deprecated/invalid
//      model name after a provider changes their catalog) matched none
//      of the old signal lists, so the entire multi-provider fallback
//      chain aborted instead of trying the next provider — the original
//      H8 finding.
//   2. Unreliable in the other direction: substring-matching a
//      re-formatted message string has no guarantee a matched fragment
//      ("500") actually refers to a status code, rather than, say, a
//      token count or model name that happens to contain those digits.
//      Worse: the old design cooled down a KEY for any matched signal,
//      including 500/502/503 (provider-wide outages unrelated to the
//      key's own validity) — wasting that key's availability for an
//      hour over a failure that had nothing to do with the key itself.
//
// classifyProviderError() below operates on the REAL structured data
// (the actual HTTP status code, parsed error body, network error code)
// captured at the point ProviderCallError is constructed in
// multiProvider.js, not on a re-parsed message string. This is a
// deliberately narrower, more precise classifier than simply "make more
// things retryable" — some things are now retryable that previously
// weren't (fixing the original complaint), and some things are more
// conservatively classified than before (never blindly retrying every
// 4xx, which would risk masking genuine application bugs behind
// eventual-success noise from cycling through every provider).
// ============================================================

export class ProviderCallError extends Error {
  constructor(message, { status = null, providerId = null, networkErrorCode = null, parsedBody = null } = {}) {
    super(message);
    this.name = 'ProviderCallError';
    this.status = status;                     // real numeric HTTP status, or null for network-level failures
    this.providerId = providerId;              // which provider produced this error
    this.networkErrorCode = networkErrorCode;  // e.g. 'ECONNREFUSED', populated only for network-level failures
    this.parsedBody = parsedBody;               // the provider's parsed JSON error body, if it parsed successfully
    this.rawMessage = message;                  // kept for logging / Sentry breadcrumbs ONLY — never used for classification
  }
}

const KEY_FAULT_STATUSES = new Set([401, 403, 429]);
const PROVIDER_TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const PROVIDER_TRANSIENT_NETWORK_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET']);

// Narrow, last-resort fallback used ONLY when a network failure doesn't
// populate a structured networkErrorCode (some platforms/Node versions
// may not consistently populate `cause.code` on a fetch failure). This is
// intentionally much narrower than the old NETWORK_SIGNALS list — a
// safety net, not the primary classification mechanism.
const NETWORK_MESSAGE_FALLBACK = /econnrefused|etimedout|enotfound|socket hang up|fetch failed/i;

// Best-effort detection of a "model not found / invalid / decommissioned"
// signal inside a provider's own structured JSON error body — checked
// against the SPECIFIC fields a provider actually uses for this purpose
// (error.type / error.code / error.message), not against a flattened
// message string. This targeted check is what makes BAD_MODEL detection
// meaningfully more reliable than the old approach would have been if
// simply extended to cover 400s by matching more substrings.
const isBadModelSignal = (parsedBody) => {
  if (!parsedBody?.error) return false;
  const text = `${parsedBody.error.type || ''} ${parsedBody.error.code || ''} ${parsedBody.error.message || ''}`.toLowerCase();
  return /model/.test(text) && /(not found|does not exist|invalid|decommission|unknown|unsupported)/.test(text);
};

/**
 * Classify a ProviderCallError into one of four categories, each mapping
 * to a distinct handling behavior in multiProvider.js's fallback loop
 * (see that file's callWithFallback/streamWithFallback catch blocks):
 *
 *   KEY_FAULT          — cool the specific key (Redis, 1h), try next key/provider.
 *                        Attributable to the key itself (bad credentials,
 *                        or this key specifically hit its rate limit).
 *   PROVIDER_TRANSIENT — do NOT cool the key, try next key/provider.
 *                        Provider-wide or network condition unrelated to
 *                        this key's validity — penalizing the key would
 *                        be incorrect and would waste its availability.
 *   BAD_MODEL          — do NOT cool the key, skip this model specifically
 *                        (not just this key), evict the model from the
 *                        Redis-backed discovery cache so other requests/
 *                        instances stop hitting it until the next natural
 *                        refresh.
 *   NON_RETRYABLE      — do not retry, rethrow immediately, report to
 *                        Sentry at error severity. Everything that isn't
 *                        one of the above three — most likely a genuine
 *                        application bug in how the request was built,
 *                        not routine provider flakiness.
 */
export const classifyProviderError = (err) => {
  if (!(err instanceof ProviderCallError)) {
    // Defensive fallback for any error that reaches this function without
    // having gone through the ProviderCallError wrapping path in
    // multiProvider.js (should not happen in normal operation, but
    // classification must never itself throw) — treat conservatively as
    // non-retryable rather than guessing at a category.
    return 'NON_RETRYABLE';
  }

  if (err.status != null && KEY_FAULT_STATUSES.has(err.status)) {
    return 'KEY_FAULT';
  }

  if (err.status != null && PROVIDER_TRANSIENT_STATUSES.has(err.status)) {
    return 'PROVIDER_TRANSIENT';
  }

  if (err.status == null) {
    if (err.networkErrorCode && PROVIDER_TRANSIENT_NETWORK_CODES.has(err.networkErrorCode)) {
      return 'PROVIDER_TRANSIENT';
    }
    if (!err.networkErrorCode && NETWORK_MESSAGE_FALLBACK.test(err.rawMessage || '')) {
      return 'PROVIDER_TRANSIENT';
    }
  }

  if (err.status === 400 && isBadModelSignal(err.parsedBody)) {
    return 'BAD_MODEL';
  }

  return 'NON_RETRYABLE';
};

export default { ProviderCallError, classifyProviderError };
