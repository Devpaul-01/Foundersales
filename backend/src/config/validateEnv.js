// src/config/validateEnv.js
// ============================================================
// STARTUP ENVIRONMENT VALIDATOR
//
// Validates all required environment variables at boot time.
// If any are missing the process exits immediately with a clear,
// per-variable error message — eliminating cryptic runtime crashes
// (e.g. "Cannot read property of undefined" from a missing API key
// deep inside a service call on first real request).
//
// Usage: call validateEnv() as the very first line of app startup,
// before any other imports touch process.env values.
// ============================================================

const REQUIRED = [
  // Supabase
  { key: 'SUPABASE_URL',            hint: 'Your Supabase project URL (e.g. https://xxx.supabase.co)' },
  { key: 'SUPABASE_SERVICE_KEY',    hint: 'Supabase service role key (from project API settings)' },

  // AI providers
  { key: 'GROQ_API_KEY',            hint: 'Groq API key — required for all AI features' },

  // Auth & security
  { key: 'ADMIN_SECRET',            hint: 'Secret header value for Bull Board at /admin/jobs' },
];

const OPTIONAL_WITH_WARNINGS = [
  { key: 'REDIS_URL',               hint: 'Redis connection URL — workspace caching will be skipped without this' },
  { key: 'EXA_API_KEY',             hint: 'Exa Search API key — opportunity discovery will fall back to Groq without this' },
  { key: 'FIREBASE_PROJECT_ID',     hint: 'Firebase project ID — push notifications will be disabled without this' },
  { key: 'FRONTEND_URL',            hint: 'Allowed CORS origin for your frontend (e.g. https://app.yoursite.com)' },
];

export const validateEnv = () => {
  const missing = REQUIRED.filter(({ key }) => !process.env[key]?.trim());

  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:\n');
    for (const { key, hint } of missing) {
      console.error(`  ${key}`);
      console.error(`    → ${hint}\n`);
    }
    console.error('Set the above variables in your .env file and restart.\n');
    process.exit(1);
  }

  const missingOptional = OPTIONAL_WITH_WARNINGS.filter(({ key }) => !process.env[key]?.trim());
  if (missingOptional.length > 0) {
    console.warn('\n⚠️  Optional environment variables not set (degraded functionality):');
    for (const { key, hint } of missingOptional) {
      console.warn(`  ${key}: ${hint}`);
    }
    console.warn('');
  }
};
