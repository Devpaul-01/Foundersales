// src/services/storage.js
// ============================================================
// FILE UPLOAD SERVICE
// Uses Supabase Storage as primary.
// Returns public URL + metadata for AI access.
// ============================================================

import supabaseAdmin from '../config/supabase.js';
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
 * Upload a file buffer to Supabase Storage.
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
  const storagePath = `${userId}/${uuidv4()}.${ext}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await supabaseAdmin.storage
    .from(UPLOAD_LIMITS.SUPABASE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  // Get public URL
  const { data: { publicUrl } } = supabaseAdmin.storage
    .from(UPLOAD_LIMITS.SUPABASE_BUCKET)
    .getPublicUrl(storagePath);

  // Store metadata in DB
  const { data: fileRecord, error: dbError } = await supabaseAdmin
    .from('file_uploads')
    .insert({
      user_id: userId,
      storage_provider: 'supabase',
      storage_path: storagePath,
      public_url: publicUrl,
      original_filename: originalFilename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      file_type: getFileType(mimeType),
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
    .select('storage_path, user_id')
    .eq('id', fileId)
    .single();

  if (!file || file.user_id !== userId) {
    throw new Error('File not found or access denied');
  }

  await supabaseAdmin.storage
    .from(UPLOAD_LIMITS.SUPABASE_BUCKET)
    .remove([file.storage_path]);

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
