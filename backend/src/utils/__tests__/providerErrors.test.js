import { describe, it, expect } from 'vitest';
import { classifyProviderError, ProviderCallError } from '../providerErrors.js';

describe('classifyProviderError', () => {
  it('classifies 401/403/429 as KEY_FAULT', () => {
    for (const status of [401, 403, 429]) {
      const err = new ProviderCallError(`HTTP ${status}`, { status, providerId: 'groq' });
      expect(classifyProviderError(err)).toBe('KEY_FAULT');
    }
  });

  it('classifies 500/502/503/504 and network errors as PROVIDER_TRANSIENT, never KEY_FAULT', () => {
    for (const status of [500, 502, 503, 504]) {
      const err = new ProviderCallError(`HTTP ${status}`, { status, providerId: 'cerebras' });
      const category = classifyProviderError(err);
      expect(category).toBe('PROVIDER_TRANSIENT');
      expect(category).not.toBe('KEY_FAULT');
    }

    const networkErr = new ProviderCallError('fetch failed', { networkErrorCode: 'ECONNREFUSED' });
    expect(classifyProviderError(networkErr)).toBe('PROVIDER_TRANSIENT');
  });

  it('classifies a 400 with a model-not-found body as BAD_MODEL, and a generic 400 as NON_RETRYABLE', () => {
    const badModelErr = new ProviderCallError('HTTP 400', {
      status: 400,
      providerId: 'groq',
      parsedBody: {
        error: {
          type: 'invalid_request_error',
          code: 'model_not_found',
          message: 'The model `llama-9000` does not exist',
        },
      },
    });
    expect(classifyProviderError(badModelErr)).toBe('BAD_MODEL');

    const genericBadRequest = new ProviderCallError('HTTP 400', {
      status: 400,
      providerId: 'groq',
      parsedBody: { error: { message: 'invalid temperature value' } },
    });
    expect(classifyProviderError(genericBadRequest)).toBe('NON_RETRYABLE');
  });

  it('classifies a 404 as BAD_MODEL only when the body names a missing model (audit 1.68)', () => {
    const missingModel = new ProviderCallError('HTTP 404', {
      status: 404, providerId: 'openrouter',
      parsedBody: { error: { code: 'model_not_found', message: 'The model `x/y:free` does not exist' } },
    });
    expect(classifyProviderError(missingModel)).toBe('BAD_MODEL');

    const wrongUrl = new ProviderCallError('HTTP 404', { status: 404, providerId: 'groq', parsedBody: { error: { message: 'Not Found' } } });
    expect(classifyProviderError(wrongUrl)).toBe('NON_RETRYABLE');

    const noBody = new ProviderCallError('HTTP 404', { status: 404, providerId: 'groq' });
    expect(classifyProviderError(noBody)).toBe('NON_RETRYABLE');
  });

  it('classifies a non-ProviderCallError defensively as NON_RETRYABLE', () => {
    const plainError = new Error('something unexpected');
    expect(classifyProviderError(plainError)).toBe('NON_RETRYABLE');
  });

  it('classifies a 429 with error.code daily_token_budget_exceeded as PROVIDER_TRANSIENT, not KEY_FAULT (llm-gateway)', () => {
    const budgetErr = new ProviderCallError('HTTP 429', {
      status: 429,
      providerId: 'gateway',
      parsedBody: { error: { message: 'daily token budget exceeded', type: 'rate_limit_error', code: 'daily_token_budget_exceeded' } },
    });
    expect(classifyProviderError(budgetErr)).toBe('PROVIDER_TRANSIENT');
  });

  it('classifies a 429 with error.code too_many_concurrent_requests as PROVIDER_TRANSIENT, not KEY_FAULT (llm-gateway)', () => {
    const concurrencyErr = new ProviderCallError('HTTP 429', {
      status: 429,
      providerId: 'gateway',
      parsedBody: { error: { message: 'too many concurrent requests', type: 'rate_limit_error', code: 'too_many_concurrent_requests' } },
    });
    expect(classifyProviderError(concurrencyErr)).toBe('PROVIDER_TRANSIENT');
  });

  it('still classifies a plain 429 (no admission-limit code) as KEY_FAULT', () => {
    const plainRateLimit = new ProviderCallError('HTTP 429', {
      status: 429,
      providerId: 'gateway',
      parsedBody: { error: { message: 'rate limited', type: 'rate_limit_error', code: 'rate_limit_error' } },
    });
    expect(classifyProviderError(plainRateLimit)).toBe('KEY_FAULT');

    const noBodyAtAll = new ProviderCallError('HTTP 429', { status: 429, providerId: 'gateway' });
    expect(classifyProviderError(noBodyAtAll)).toBe('KEY_FAULT');
  });
});
