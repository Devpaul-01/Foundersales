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

  it('classifies a non-ProviderCallError defensively as NON_RETRYABLE', () => {
    const plainError = new Error('something unexpected');
    expect(classifyProviderError(plainError)).toBe('NON_RETRYABLE');
  });
});
