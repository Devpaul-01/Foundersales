// src/config/cloudinary.js
// ============================================================
// Cloudinary SDK configuration.
// Requires: npm install cloudinary
// Env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// (or a single CLOUDINARY_URL — the SDK auto-reads that too)
// ============================================================

import { v2 as cloudinary } from 'cloudinary';

// Full audit 1.58: only pass the discrete vars that are actually set. Passing
// them unconditionally handed the SDK explicit `undefined` values, which
// OVERWRITE the config it derives from CLOUDINARY_URL — so setting only
// CLOUDINARY_URL (as the header above says is supported) left cloud_name,
// api_key and api_secret all unset and every upload failed.
const discrete = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
};
const defined = Object.fromEntries(Object.entries(discrete).filter(([, v]) => v));

cloudinary.config({ ...defined, secure: true });

export default cloudinary;
