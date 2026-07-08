// src/services/storage.js
// ============================================================
// FILE UPLOAD SERVICE
// Uses Cloudinary as primary storage provider.
// Returns public URL + metadata for AI access.
//
// NOTE: DB metadata (file_uploads table) is still read/written via
// supabaseAdmin — only the file STORAGE backend has moved to Cloudinary.
// If you also want the metadata table off Supabase, that's a separate swap.
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import cloudinary from '../config/cloudinary.js';
import { UPLOAD_LIMITS } from '../config/constants.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Detect file type category from MIME type
 */
const getFileType = (mimeType) => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('word') || mimeType === 'text/plain') return 'document';
  return 'other';
};

/**
 * Cloudinary needs a resource_type hint. Images get native image
 * handling (transformations, etc). Everything else (pdf, docs, misc)
 * must go up as 'raw' or Cloudinary will reject/mangle it.
 */
const getResourceType = (fileType) => (fileType === 'image' ? 'image' : 'raw');

/**
 * Upload a buffer to Cloudinary via its upload_stream API,
 * wrapped in a Promise since it's callback-based.
 */
const uploadBufferToCloudinary = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });

/**
 * Upload a file buffer to Cloudinary.
 * Stores metadata in file_uploads table.
 *
 * @param {Buffer} buffer - File contents
 * @param {object} meta - { originalFilename, mimeType, sizeBytes, userId, chatId? }
 * @returns {{ url: string, fileRecord: object }}
 */
export const uploadFile = async (buffer, { originalFilename, mimeType, sizeBytes, userId, chatId }) => {
  // Validate file type
  if (!UPLOAD_LIMITS.ALLOWED_TYPES.includes(mimeType)) {
    throw new Error(`File type ${mimeType} is not supported. Allowed: images, PDFs, and documents.`);
  }

  // Validate file size
  if (sizeBytes > UPLOAD_LIMITS.MAX_SIZE_BYTES) {
    throw new Error(`File too large. Maximum size is ${UPLOAD_LIMITS.MAX_SIZE_BYTES / 1024 / 1024}MB.`);
  }

  const ext = originalFilename.split('.').pop() || 'bin';
  const fileType = getFileType(mimeType);
  const resourceType = getResourceType(fileType);

  // Cloudinary builds its own path from folder + public_id.
  // We mirror the old `${userId}/${uuid}.${ext}` layout for continuity.
  const publicId = uuidv4();
  const folder = userId;

  let uploadResult;
  try {
    uploadResult = await uploadBufferToCloudinary(buffer, {
      folder,
      public_id: publicId,
      resource_type: resourceType,
      // Preserve original extension/format for raw files (pdf/doc/etc)
      // so the delivered URL still ends in the right extension.
      format: resourceType === 'raw' ? ext : undefined,
      use_filename: false,
      unique_filename: false,
      overwrite: false
    });
  } catch (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const storagePath = uploadResult.public_id; // e.g. "userId/uuid"
  const publicUrl = uploadResult.secure_url;

  // Store metadata in DB
  const { data: fileRecord, error: dbError } = await supabaseAdmin
    .from('file_uploads')
    .insert({
      user_id: userId,
      storage_provider: 'cloudinary',
      storage_path: storagePath,
      resource_type: resourceType,
      public_url: publicUrl,
      original_filename: originalFilename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      file_type: fileType,
      chat_id: chatId || null
    })
    .select()
    .single();

  if (dbError) throw new Error(`Metadata save failed: ${dbError.message}`);

  return { url: publicUrl, fileRecord };
};

/**
 * Delete a file from storage + DB.
 * Only the owning user can delete their files.
 */
export const deleteFile = async (fileId, userId) => {
  const { data: file } = await supabaseAdmin
    .from('file_uploads')
    .select('storage_path, resource_type, user_id')
    .eq('id', fileId)
    .single();

  if (!file || file.user_id !== userId) {
    throw new Error('File not found or access denied');
  }

  await cloudinary.uploader.destroy(file.storage_path, {
    resource_type: file.resource_type || 'image'
  });

  await supabaseAdmin
    .from('file_uploads')
    .delete()
    .eq('id', fileId);
};

/**
 * Build attachment context for AI prompts.
 * Generates the right format based on what the model supports.
 * Grok: URL reference
 * Future models: Base64 for image models
 */
export const buildAttachmentContext = (attachments) => {
  if (!attachments?.length) return '';

  const parts = attachments.map(file => {
    if (file.file_type === 'image') {
      return `[Image attached: ${file.original_filename}] URL: ${file.public_url}`;
    }
    if (file.file_type === 'pdf') {
      return `[PDF document attached: ${file.original_filename}] URL: ${file.public_url} — Please reference the content of this document in your response.`;
    }
    return `[File attached: ${file.original_filename}] URL: ${file.public_url}`;
  });

  return `\n\nATTACHED FILES:\n${parts.join('\n')}`;
};

export default { uploadFile, deleteFile, buildAttachmentContext };
