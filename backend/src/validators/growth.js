// validators/growth.js — PATCH
// Add `offset` to feedQuerySchema to support paginated GET /api/growth/feed.
// Merge this change into your existing validators/growth.js feedQuerySchema.

// ── BEFORE ────────────────────────────────────────────────────
// export const feedQuerySchema = z.object({
//   limit: z.coerce.number().int().min(1).max(50).default(20),
// });

// ── AFTER ─────────────────────────────────────────────────────
// export const feedQuerySchema = z.object({
//   limit:  z.coerce.number().int().min(1).max(50).default(20),
//   offset: z.coerce.number().int().min(0).default(0),    // ← ADD THIS LINE
// });

// ─────────────────────────────────────────────────────────────
// Full replacement (if you prefer to copy/paste):
import { z } from 'zod';

export const feedQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const checkInSubmitSchema = z.object({
  answers:    z.record(z.string()).or(z.array(z.any())),
  mood_score: z.number().int().min(1).max(10).optional().nullable(),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const historyQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  type:   z.enum(['tips', 'plans', 'all']).default('all'),
});
