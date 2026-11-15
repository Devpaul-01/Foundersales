// src/services/storage.js — IMPLEMENTATION PASS
//
// CHANGE: getFileType/getResourceType now recognize audio mime types
// (previously only image/pdf/document/other were classified, so an audio
// upload would have fallen into 'other' -> 'raw' resource type, which
// works but doesn't get Cloudinary's audio/video-specific handling like
// duration extraction). Everything else in this file is unchanged —
// uploadFile/deleteFile/buildAttachmentContext are reused as-is by
// services/voiceMemoService.js for both the "record in-app" and "upload
// existing file" voice memo workflows; voice memos are not a separate
// storage integration.
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import cloudinary from '../config/cloudinary.js';
import { UPLOAD_LIMITS } from '../config/constants.js';
import { v4 as uuidv4 } from 'uuid';

// Extensions for the mime types that upload as Cloudinary 'raw' (images use
// resource_type 'image' and get no explicit format). Anything not listed
// falls back to 'bin'.
const RAW_EXTENSION_BY_MIME = {
  'application/pdf': 'pdf',
  'text/plain':      'txt',
  'text/csv':        'csv',
};

/**
 * Detect file type category from MIME type
 */
const getFileType = (mimeType) => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('audio/')) return 'audio'; // NEW
  if (mimeType.includes('word') || mimeType === 'text/plain') return 'document';
  return 'other';
};

/**
 * Cloudinary needs a resource_type hint. Images get native image
 * handling. Audio/video get 'video' (Cloudinary's audio handling lives
 * under the video resource type — this is also what gives us duration
 * metadata back in the upload response for free). Everything else (pdf,
 * docs, misc) goes up as 'raw' or Cloudinary will reject/mangle it.
 */
const getResourceType = (fileType) => {
  if (fileType === 'image') return 'image';
  if (fileType === 'audio') return 'video'; // NEW — Cloudinary convention for audio
  return 'raw';
};

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
 * @param {object} meta - { originalFilename, mimeType, sizeBytes, userId, chatId?, eventId? }
 * @returns {{ url: string, fileRecord: object, durationSeconds: number|null }}
 */
export const uploadFile = async (buffer, { originalFilename, mimeType, sizeBytes, userId, chatId }) => {
  if (!UPLOAD_LIMITS.ALLOWED_TYPES.includes(mimeType)) {
    throw new Error(`File type ${mimeType} is not supported. Allowed: images, PDFs, and documents.`);
  }

  if (sizeBytes > UPLOAD_LIMITS.MAX_SIZE_BYTES) {
    throw new Error(`File too large. Maximum size is ${UPLOAD_LIMITS.MAX_SIZE_BYTES / 1024 / 1024}MB.`);
  }

  // Full audit 1.55: derive the stored extension from the VALIDATED mime type,
  // not from the client-supplied filename. Previously a file declared as
  // application/pdf but named "x.html" was stored and served as ".html"
  // (raw uploads are not content-checked by Cloudinary).
  const ext = RAW_EXTENSION_BY_MIME[mimeType] || 'bin';
  const fileType = getFileType(mimeType);
  const resourceType = getResourceType(fileType);

  const publicId = uuidv4();
  const folder = userId;

  let uploadResult;
  try {
    uploadResult = await uploadBufferToCloudinary(buffer, {
      folder,
      public_id: publicId,
      resource_type: resourceType,
      format: resourceType === 'raw' ? ext : undefined,
      use_filename: false,
      unique_filename: false,
      overwrite: false
    });
  } catch (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const storagePath = uploadResult.public_id;
  const publicUrl = uploadResult.secure_url;

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

  if (dbError) {
    // Full audit 1.55: the object is already in Cloudinary. Without this
    // cleanup a failed metadata insert (e.g. an invalid chat_id) left an
    // orphaned, unreferenced upload behind. Best-effort: never mask the
    // real error.
    try {
      await cloudinary.uploader.destroy(storagePath, { resource_type: resourceType });
    } catch (cleanupErr) {
      console.warn(`[Storage] Orphan cleanup failed for ${storagePath}:`, cleanupErr.message);
    }
    throw new Error(`Metadata save failed: ${dbError.message}`);
  }

  return {
    url: publicUrl,
    fileRecord,
    // Cloudinary's video/audio resource_type response includes `duration`
    // (seconds, float) — surfaced here so callers (voiceMemoService) don't
    // need a second probe of the file.
    durationSeconds: resourceType === 'video' && uploadResult.duration ? Math.round(uploadResult.duration) : null,
  };
};

/**
 * Upload a raw audio Buffer without requiring a file_uploads row —
 * used specifically by voiceMemoService, which maintains its OWN
 * dedicated voice_memos table (richer schema: transcription status,
 * transcript full-text search, AI summary) rather than reusing
 * file_uploads, which has no fields for any of that. This still goes
 * through the same Cloudinary upload path as uploadFile() above; it just
 * skips the file_uploads insert since voice_memos is the record of truth
 * for this content type.
 */
export const uploadAudioBuffer = async (buffer, { originalFilename, mimeType, userId }) => {
  const ext = originalFilename?.split('.').pop() || 'webm';
  const publicId = uuidv4();

  const uploadResult = await uploadBufferToCloudinary(buffer, {
    folder: `${userId}/voice-memos`,
    public_id: publicId,
    resource_type: 'video', // Cloudinary convention for audio
    use_filename: false,
    unique_filename: false,
    overwrite: false,
  });

  return {
    url: uploadResult.secure_url,
    storagePath: uploadResult.public_id,
    durationSeconds: uploadResult.duration ? Math.round(uploadResult.duration) : null,
    bytes: uploadResult.bytes,
  };
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

  // Full audit 1.55: this used to ignore the result, so a failed row delete
  // (after the Cloudinary object was already destroyed) still reported
  // success and left a dangling file_uploads row. Scoped to the owner as
  // defense in depth (ownership was already checked above).
  const { error: deleteError } = await supabaseAdmin
    .from('file_uploads')
    .delete()
    .eq('id', fileId)
    .eq('user_id', userId);
  if (deleteError) throw new Error(`Metadata delete failed: ${deleteError.message}`);
};

/**
 * Deletes a Cloudinary object by storage path directly (no file_uploads
 * row involved) — used by voiceMemoService to clean up audio objects.
 */
export const deleteAudioObject = async (storagePath) => {
  await cloudinary.uploader.destroy(storagePath, { resource_type: 'video' });
};

/**
 * Build attachment context for AI prompts.
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

export default { uploadFile, uploadAudioBuffer, deleteFile, deleteAudioObject, buildAttachmentContext };
