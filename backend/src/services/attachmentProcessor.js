// src/utils/attachmentProcessor.js
// ============================================================
// ATTACHMENT PREPROCESSOR FOR GROK
// Grok does not support direct URL ingestion for files.
// Images  → fetch + encode to Base64 inline data URL
// PDFs    → extract text using pdf-parse
// Docs    → extract raw text
// Only applied for Grok. Other models (future) handled separately.
// ============================================================

import axios from 'axios';
import { parseTextResponse } from './parser.js';

/**
 * Process attachments into a format Grok can understand.
 * Returns: array of { type, content, filename } objects
 *
 * @param {array} attachments - file records from file_uploads table
 * @returns {array} processed attachments ready for prompt injection
 */
export const preprocessAttachmentsForGrok = async (attachments) => {
  if (!attachments?.length) return [];

  const processed = [];

  for (const file of attachments) {
    try {
      if (file.file_type === 'image') {
        const base64 = await fetchAsBase64(file.public_url);
        if (base64) {
          processed.push({
            type: 'image',
            filename: file.original_filename,
            // Grok accepts base64 image content in the message
            content: null,
            inline_data: `data:${file.mime_type};base64,${base64}`
          });
        }
      } else if (file.file_type === 'pdf') {
        const text = await extractPdfText(file.public_url);
        if (text) {
          processed.push({
            type: 'document',
            filename: file.original_filename,
            content: text.slice(0, 8000) // Cap at 8k chars to avoid token explosion
          });
        }
      } else if (file.file_type === 'document') {
        const text = await fetchRawText(file.public_url);
        if (text) {
          processed.push({
            type: 'document',
            filename: file.original_filename,
            content: text.slice(0, 8000)
          });
        }
      }
    } catch (err) {
      console.warn(`[AttachmentProcessor] Failed to process ${file.original_filename}:`, err.message);
      // Degrade gracefully — include filename reference at minimum
      processed.push({
        type: 'unknown',
        filename: file.original_filename,
        content: `[File "${file.original_filename}" could not be processed — reference it by name if needed]`
      });
    }
  }

  return processed;
};

/**
 * Build the prompt text block that gets appended to the user's message.
 * For images: inserts inline base64 (if model supports vision)
 * For documents: inserts extracted text
 */
export const buildGrokAttachmentPrompt = (processedAttachments) => {
  if (!processedAttachments?.length) return '';

  const parts = processedAttachments.map(att => {
    if (att.type === 'image' && att.inline_data) {
      // Note: Grok-3-mini is text-only. If xAI releases vision model,
      // this block will pass inline_data through the messages API.
      // For now, we note the image was attached.
      return `[Image attached: "${att.filename}" — describe this image if asked about it]`;
    }
    if (att.type === 'document' || att.type === 'pdf') {
      return `\n--- Document: "${att.filename}" ---\n${att.content}\n--- End of document ---`;
    }
    return att.content || '';
  });

  return `\n\nATTACHED FILES:\n${parts.join('\n')}`;
};

// ──────────────────────────────────────────
// INTERNAL HELPERS
// ──────────────────────────────────────────

const fetchAsBase64 = async (url) => {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: 10 * 1024 * 1024  // 10MB max
  });
  return Buffer.from(response.data).toString('base64');
};

const extractPdfText = async (url) => {
  // Dynamically import pdf-parse (add to package.json: "pdf-parse": "^1.1.1")
  try {
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
    const buffer = Buffer.from(response.data);
    const result = await pdfParse(buffer);
    return result.text?.trim() || null;
  } catch (err) {
    // pdf-parse not installed or parse failed — fall back to raw fetch
    return await fetchRawText(url);
  }
};

const fetchRawText = async (url) => {
  const response = await axios.get(url, {
    responseType: 'text',
    timeout: 10000,
    maxContentLength: 5 * 1024 * 1024
  });
  return typeof response.data === 'string' ? response.data.trim() : null;
};