// src/middleware/errorHandler.js — IMP-06
export class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const errorHandler = (err, req, res, next) => {
  if (err.code && (err.hint !== undefined || err.details !== undefined)) {
    console.error('[DB Error]', { code: err.code, message: err.message });
    return res.status(500).json({ error: 'DB_ERROR', message: 'A database error occurred.' });
  }
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.code || 'APP_ERROR', message: err.message });
  }
  console.error('[Unhandled Error]', err);
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong.' });
};
