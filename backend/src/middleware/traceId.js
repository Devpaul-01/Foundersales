// src/middleware/traceId.js
// ============================================================
// REQUEST TRACE ID MIDDLEWARE
//
// Attaches a unique trace ID to every incoming request.
// The ID is:
//   - Set as req.traceId (available to all downstream middleware and handlers)
//   - Echoed in the X-Trace-Id response header (useful for client-side debugging)
//
// In a multi-instance or microservice deployment, including this ID
// in every log line lets you correlate all log entries for a single
// request even when they are interleaved with entries from other requests.
//
// Usage: mount before all routes in app.js.
// ============================================================

import { randomUUID } from 'crypto';

export const traceId = (req, res, next) => {
  // Use the incoming header if the gateway already set one (e.g. from a load balancer),
  // otherwise generate a fresh UUID. This preserves trace continuity across services.
  // Full audit 1.70: only trust a well-formed incoming id (short, no spaces or
  // control characters); anything else is replaced, so a client cannot inject
  // arbitrary text into logs or response headers that later use req.traceId.
  const incoming = req.headers['x-trace-id'];
  req.traceId = typeof incoming === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Trace-Id', req.traceId);
  next();
};
