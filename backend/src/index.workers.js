// src/index.workers.js — true process entry point for the worker-only
// process (src/workers/index.js).
//
// Same fix, same reasoning as src/index.js and src/index.server.js — see
// docs/backend-takeover/AUDIT.md 1.1. This file imports nothing but
// dotenv and validateEnv, validates, and only then dynamically imports
// workers/index.js, guaranteeing validation genuinely happens before any
// job file (many of which import config/supabase.js at module top-level)
// is loaded.
//
// Run with: node src/index.workers.js
import 'dotenv/config';
import { validateEnv } from './config/validateEnv.js';

validateEnv();

await import('./workers/index.js');
