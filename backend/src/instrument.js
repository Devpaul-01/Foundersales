// src/instrument.js
// ============================================================
// SENTRY PRELOAD (full audit 1.72)
//
// Loaded with `node --import ./src/instrument.js src/index.js` (see the
// "start" and "dev" scripts in package.json). ES module `import` statements
// are hoisted, so calling initSentry() from app.js/server.js runs AFTER
// express, http and every route module have already loaded; with
// @sentry/node 10.x on ESM that is too late for its automatic
// instrumentation (traces for http/express/etc.). Initializing here, before
// the app is imported, is what Sentry's ESM setup requires.
//
// initSentry() is idempotent and a no-op without SENTRY_DSN, so the later
// call in app.js/server.js is harmless, and running WITHOUT this preload
// (e.g. a hosting platform with its own start command) still works — only the
// automatic tracing is lost, explicit captureException calls are unaffected.
// ============================================================
import 'dotenv/config';
import { initSentry } from './config/sentry.js';

initSentry();
