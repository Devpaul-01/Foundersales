// src/index.js — true process entry point.
//
// WHY THIS FILE EXISTS (see docs/backend-takeover/AUDIT.md 1.1):
//
// app.js used to call validateEnv() itself, early, with a comment claiming
// it ran "before any other imports touch process.env values." That
// guarantee did not actually hold: ES module `import` statements are
// hoisted, meaning every module in app.js's import graph is resolved and
// its top-level code executed BEFORE any statement in app.js runs —
// regardless of where in the file the import appears. config/supabase.js
// constructs its Supabase clients at module top-level, and is reachable
// from app.js's very first route import (middleware/auth.js), so it was
// already running — with possibly-missing env vars — before app.js's own
// validateEnv() call ever executed. Reproduced directly: running the old
// entry point with no environment variables set crashed with a raw
// Supabase SDK stack trace, not validateEnv's intended clean message.
//
// The fix is this file. It imports NOTHING except dotenv and validateEnv,
// calls validateEnv() (which process.exit(1)s with a clear per-variable
// message on failure), and only THEN dynamically imports app.js. A
// dynamic import() is not hoisted — it only begins resolving once this
// line actually executes, which is after validateEnv() has already
// returned successfully. This guarantees validateEnv truly runs first,
// for every module in the app, without having to touch the other ~25
// imports inside app.js or the 49 files that import config/supabase.js
// elsewhere in the codebase.
//
// package.json's start/dev scripts point here now, not at app.js directly.
import 'dotenv/config';
import { validateEnv } from './config/validateEnv.js';

validateEnv();

await import('./app.js');
