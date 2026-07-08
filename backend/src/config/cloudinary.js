// src/config/cloudinary.js
// ============================================================
// Cloudinary SDK configuration.
// Requires: npm install cloudinary
// Env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// (or a single CLOUDINARY_URL — the SDK auto-reads that too)
// ============================================================

import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

export default cloudinary;
