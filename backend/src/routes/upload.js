// src/routes/upload.js
// ============================================================
// FILE UPLOAD ROUTES
// Uses multer for multipart parsing, Supabase Storage for persistence.
// ============================================================

import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadFile, deleteFile } from '../services/storage.js';
import { UPLOAD_LIMITS } from '../config/constants.js';
import supabaseAdmin from '../config/supabase.js';
import { createRateLimitStore } from '../config/rateLimitStore.js';

const router = Router();

// IMPL-RATELIMIT-01 (Phase 2 refactor): file uploads previously had ZERO
// rate limiting of any kind — discovered during this refactor's
// endpoint-by-endpoint rate-limit review. Upload has real resource cost
// (multipart parsing, Supabase Storage write, bandwidth) independent of
// AI cost, and is a classic under-protected surface. Applied to POST /
// ONLY (see below) — GET / (list files) and DELETE /:id are cheap
// DB-only operations that shouldn't share this budget; a user paging
// through a file picker shouldn't be throttled by the same limit that
// bounds actual upload volume. Redis-backed (config/rateLimitStore.js)
// so this is enforced correctly across every instance in a
// horizontally-scaled deployment. 20 uploads / 15 min / user is
// deliberately generous for legitimate use (attaching a few files to a
// conversation) while still bounding scripted abuse.
const uploadPostRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many uploads. Please wait a few minutes.' },
  store: await createRateLimitStore(),
});

// Use memory storage - we stream to Supabase Storage directly
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMITS.MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (UPLOAD_LIMITS.ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not supported`));
    }
  }
});

// POST /api/upload - Upload a file
// IMPL-RATELIMIT-01: uploadPostRateLimiter applied here only — see its
// definition above.
router.post('/', uploadPostRateLimiter, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No file provided' });
  }

  const { chat_id } = req.body;

  const { url, fileRecord } = await uploadFile(req.file.buffer, {
    originalFilename: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    userId: req.user.id,
    chatId: chat_id || null
  });

  res.status(201).json({
    success: true,
    file: {
      id: fileRecord.id,
      url,
      filename: fileRecord.original_filename,
      type: fileRecord.file_type,
      size_bytes: fileRecord.size_bytes
    }
  });
}));

// DELETE /api/upload/:id - Delete a file
router.delete('/:id', asyncHandler(async (req, res) => {
  await deleteFile(req.params.id, req.user.id);
  res.json({ success: true });
}));

// GET /api/upload - List user's uploaded files
router.get('/', asyncHandler(async (req, res) => {
  const { chat_id, limit = 20 } = req.query;

  let query = supabaseAdmin
    .from('file_uploads')
    .select('id, public_url, original_filename, file_type, size_bytes, created_at, chat_id')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(parseInt(limit));

  if (chat_id) query = query.eq('chat_id', chat_id);

  const { data, error } = await query;
  if (error) throw error;

  res.json({ files: data || [] });
}));

export default router;
