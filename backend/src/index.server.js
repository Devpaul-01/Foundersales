// src/index.server.js — true process entry point for the API-only process.
//
// Same fix, same reasoning as src/index.js (see that file's header comment
// and docs/backend-takeover/AUDIT.md 1.1). server.js had the identical
// validateEnv-doesn't-actually-run-first bug as app.js, for the identical
// reason: validateEnv() was called early in server.js's own top-level code,
// but ES module import hoisting means every module server.js statically
// imports — including, transitively, config/supabase.js, which constructs
// a Supabase client at import time — is already resolved and executed
// before that call runs.
//
// This file imports nothing but dotenv and validateEnv, validates, and
// only then dynamically imports server.js. Use this as the actual process
// entry point instead of running server.js directly.
//
// Run with: node src/index.server.js
import 'dotenv/config';
import { validateEnv } from './config/validateEnv.js';

validateEnv();

await import('./server.js');
