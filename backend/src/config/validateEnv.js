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
  // NOTE: this used to say SUPABASE_SERVICE_KEY, which is not the variable
  // config/supabase.js actually reads (SUPABASE_SERVICE_ROLE_KEY). That
  // meant this check could never catch a genuinely missing service key —
  // see docs/backend-takeover/AUDIT.md 1.1.
  { key: 'SUPABASE_SERVICE_ROLE_KEY', hint: 'Supabase service role key (from project API settings, Service Role, not anon)' },

  // AI providers
  // GATEWAY_API_KEY (feat/llm-gateway-provider): all AI CHAT traffic now
  // routes through a single self-hosted gateway
  // (github.com/Devpaul-01/llm-gateway) instead of calling Cerebras,
  // Groq, Mistral, or OpenRouter directly — see services/multiProvider.js.
  { key: 'GATEWAY_API_KEY',         hint: 'llm-gateway API key — required for all AI chat features (see services/multiProvider.js)' },
  // GROQ_API_KEY is UNRELATED to the gateway above and still required —
  // it is read directly by services/transcription.js for voice-memo
  // audio transcription (Groq's Whisper-compatible endpoint), which has
  // no equivalent on the gateway and was intentionally left alone.
  { key: 'GROQ_API_KEY',            hint: 'Groq API key — required for voice-memo audio transcription (see services/transcription.js)' },

  // Auth & security
  { key: 'ADMIN_SECRET',            hint: 'Secret header value for Bull Board at /admin/jobs' },
];

const OPTIONAL_WITH_WARNINGS = [
  // Constructed at startup by config/supabase.js (the `supabase` named
  // export) even though nothing in the codebase currently imports that
  // export — see docs/backend-takeover/AUDIT.md for a note on removing the
  // dead export itself in a follow-up. Kept as an optional-with-warning
  // here rather than required, since no route path currently depends on it.
  { key: 'SUPABASE_ANON_KEY',       hint: 'Supabase anon key — only used by the currently-unused non-admin Supabase client' },
  { key: 'REDIS_URL',               hint: 'Redis connection URL — workspace caching will be skipped without this' },
  { key: 'EXA_API_KEY',             hint: 'Exa Search API key — opportunity discovery will fall back to Groq without this' },
  // NOTE: this used to say FIREBASE_PROJECT_ID, which config/firebase.js
  // does not read at all — it reads FIREBASE_SERVICE_ACCOUNT (a JSON
  // credential blob), so this check could never catch the actual missing
  // variable. Same bug class as the SUPABASE_SERVICE_KEY mismatch above —
  // see docs/backend-takeover/AUDIT.md.
  { key: 'FIREBASE_SERVICE_ACCOUNT', hint: 'Firebase service account JSON (as a single-line string) — push notifications will be disabled without this' },
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
  // Full audit 1.70: Cloudinary is only configured when CLOUDINARY_URL or all
  // three discrete vars are set (config/cloudinary.js). Without it, file
  // uploads and voice memos fail only when first used; warn at boot instead.
  const hasCloudinary = !!process.env.CLOUDINARY_URL?.trim() ||
    ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].every((k) => process.env[k]?.trim());
  if (!hasCloudinary) {
    missingOptional.push({
      key: 'CLOUDINARY_URL (or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET)',
      hint: 'Cloudinary credentials — file uploads and voice memos will fail without this',
    });
  }
  if (missingOptional.length > 0) {
    console.warn('\n⚠️  Optional environment variables not set (degraded functionality):');
    for (const { key, hint } of missingOptional) {
      console.warn(`  ${key}: ${hint}`);
    }
    console.warn('');
  }
};
