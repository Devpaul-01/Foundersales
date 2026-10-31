import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression test for docs/backend-takeover/AUDIT.md 1.1: validateEnv.js
// used to check for `SUPABASE_SERVICE_KEY`, a variable name nothing else
// in the codebase reads — config/supabase.js actually reads
// `SUPABASE_SERVICE_ROLE_KEY`. That meant validateEnv could never catch a
// genuinely missing service role key: it would pass even with
// SUPABASE_SERVICE_ROLE_KEY unset, as long as the (wrong, unused)
// SUPABASE_SERVICE_KEY name happened to be set to anything, or silently
// let a real deployment through with no service key at all.
//
// This test doesn't cover the separate ESM-import-hoisting half of 1.1
// (that`validateEnv()` previously didn't even run before other modules'
// top-level code) — that's a module-load-order property of the real
// multi-file app, not something a unit test of this pure function can
// exercise meaningfully. It's verified instead by the boot-time
// reproduction recorded in PROGRESS.md (clean-env boot now exits with
// validateEnv's message, not a raw SDK crash) and by index.js/
// index.server.js/index.workers.js structurally guaranteeing
// validateEnv() runs before any other static import via a dynamic
// import() boundary.

const REQUIRED_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GROQ_API_KEY', 'ADMIN_SECRET'];

const ALL_ENV_KEYS = [
  ...REQUIRED_KEYS,
  'SUPABASE_ANON_KEY', 'REDIS_URL', 'EXA_API_KEY', 'FIREBASE_PROJECT_ID', 'FRONTEND_URL',
];

describe('validateEnv', () => {
  const originalEnv = {};
  let exitSpy;
  let errorSpy;
  let warnSpy;

  beforeEach(() => {
    for (const key of ALL_ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of ALL_ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    vi.restoreAllMocks();
  });

  it('checks the actual variable name config/supabase.js reads (SUPABASE_SERVICE_ROLE_KEY), not a stale alias', async () => {
    const { validateEnv } = await import('../validateEnv.js');

    // Set every required var EXCEPT the real service-role key name, and
    // set the old, wrong name instead — this is exactly the scenario the
    // bug let through silently.
    process.env.SUPABASE_URL = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'this-is-the-wrong-variable-name'; // old, unused name
    process.env.GROQ_API_KEY = 'fake-groq-key';
    process.env.ADMIN_SECRET = 'fake-admin-secret';

    validateEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
    const loggedLines = errorSpy.mock.calls.flat().join('\n');
    expect(loggedLines).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('passes when all four required variables (real names) are set, and does not exit', async () => {
    const { validateEnv } = await import('../validateEnv.js');

    process.env.SUPABASE_URL = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
    process.env.GROQ_API_KEY = 'fake-groq-key';
    process.env.ADMIN_SECRET = 'fake-admin-secret';

    validateEnv();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('treats REDIS_URL as optional (warns, does not exit) — guards against re-coupling it to bullmq.js behavior', async () => {
    const { validateEnv } = await import('../validateEnv.js');

    process.env.SUPABASE_URL = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
    process.env.GROQ_API_KEY = 'fake-groq-key';
    process.env.ADMIN_SECRET = 'fake-admin-secret';
    // REDIS_URL intentionally left unset.

    validateEnv();

    expect(exitSpy).not.toHaveBeenCalled();
    const warnedLines = warnSpy.mock.calls.flat().join('\n');
    expect(warnedLines).toContain('REDIS_URL');
  });
});
