// src/middleware/validate.js — IMP-05
// Supports validating req.body (default) or req.query via the source param.
// Usage:
//   validate(mySchema)               → validates req.body
//   validate(mySchema, 'query')      → validates req.query
export const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      details: result.error.flatten().fieldErrors,
    });
  }
  req[source] = result.data;
  next();
};
