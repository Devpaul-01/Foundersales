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
// IMPORTANT: `file.type` coming from the app is NOT guaranteed to be a real
// MIME string — logs show it arrives as a coarse category like "document"
// or "image" (not "image/png"). Match on substring so this works whether
// `type` is a full MIME string or just a category word.
const classifyFile = (type = '') => {
  const t = type.toLowerCase();
  if (t.includes('image')) return 'image';
  if (t.includes('pdf')) return 'pdf';
  return 'document';
};

// Best-effort real MIME type for the base64 data URI (needed for images —
// `data:<mime>;base64,...`). Falls back to sniffing the filename extension
// since `file.type` may just be the category "image", not "image/png".
const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};
const resolveMimeType = (type, filename) => {
  if (type && type.includes('/')) return type; // already a real MIME string
  const ext = filename?.split('.').pop()?.toLowerCase();
  return EXT_MIME[ext] || 'image/png';
};

// ------------------------------------------------------------------
// Token-budget caps
// ------------------------------------------------------------------
// Per-file cap (existing behaviour, kept as-is): 8000 chars per document.
//
// NEW: aggregate cap across ALL attachments in a single message. Ten PDFs
// at 8k chars each is 80k chars (~20k+ tokens) in one shot — that's before
// this message even becomes "history" for the next turn. This trims the
// tail of the attachment list once the total budget is hit, rather than
// silently sending everything.
const MAX_TOTAL_ATTACHMENT_CHARS = 16000;

// NEW: much smaller cap used when an OLDER message's attachment content is
// being re-surfaced as part of conversation history for a later turn. Full
// document text only earns its keep on the turn it's actually discussed —
// resending 8k chars per file on every subsequent message in the chat is
// how token usage silently balloons as a conversation gets longer.
const MAX_HISTORY_SNIPPET_CHARS = 400;

/**
 * Enforce the aggregate char budget across a set of processed attachments.
 * Keeps documents in order, truncating/dropping once the total is hit, and
 * appends a note so the model (and logs) know content was cut for budget
 * reasons rather than silently vanishing.
 */
const capProcessedAttachments = (processed, maxTotalChars = MAX_TOTAL_ATTACHMENT_CHARS) => {
  let remaining = maxTotalChars;
  const capped = [];
  let omittedCount = 0;

  for (const att of processed) {
    const size = att.content?.length || 0;

    if (remaining <= 0) {
      omittedCount += 1;
      continue;
    }

    if (size <= remaining) {
      capped.push(att);
      remaining -= size;
    } else {
      // Truncate this one to fit what's left, then budget is exhausted.
      capped.push({
        ...att,
        content: `${att.content.slice(0, remaining)}\n[...truncated to stay within attachment token budget]`,
      });
      remaining = 0;
    }
  }

  if (omittedCount > 0) {
    capped.push({
      type: 'unknown',
      filename: `+${omittedCount} more file(s)`,
      content: `[${omittedCount} additional attachment(s) omitted to stay within the per-message attachment budget]`,
    });
  }

  return capped;
};

/**
 * Build a condensed, budget-capped summary of previously-processed
 * attachments, meant for re-inclusion in conversation history on LATER
 * turns (as opposed to buildGrokAttachmentPrompt, which is for the turn
 * the attachment was actually sent on). Each file is trimmed hard since
 * this gets paid for on every subsequent message in the chat.
 */
export const buildAttachmentHistorySummary = (processedAttachments, maxCharsPerFile = MAX_HISTORY_SNIPPET_CHARS) => {
  if (!processedAttachments?.length) return '';

  const parts = processedAttachments.map(att => {
    if (att.type === 'image') {
      return `[Image "${att.filename}" was attached earlier in this conversation]`;
    }
    if ((att.type === 'document' || att.type === 'pdf') && att.content) {
      const truncated = att.content.length > maxCharsPerFile;
      const snippet = att.content.slice(0, maxCharsPerFile);
      return `[Earlier attachment "${att.filename}"${truncated ? ' (truncated)' : ''}: ${snippet}]`;
    }
    return `[Attachment "${att.filename}" was referenced earlier in this conversation]`;
  });

  return `\n\n(Context from files attached earlier — condensed: ${parts.join(' ')})`;
};

export const preprocessAttachmentsForGrok = async (attachments) => {
  console.log('[AttachmentProcessor] preprocessAttachmentsForGrok called with', {
    count: attachments?.length || 0,
    attachments: attachments?.map(a => ({ name: a.name, type: a.type, hasUrl: !!a.url })),
  });

  if (!attachments?.length) return [];

  const processed = [];

  for (const file of attachments) {
    const filename = file.name;
    const url = file.url;
    const kind = classifyFile(file.type);

    console.log(`[AttachmentProcessor] Processing "${filename}"`, { rawType: file.type, kind, hasUrl: !!url });

    if (!url) {
      console.warn(`[AttachmentProcessor] "${filename}" has no url — skipping fetch, using placeholder`);
      processed.push({
        type: 'unknown',
        filename,
        content: `[File "${filename}" was attached but has no accessible URL — reference it by name if needed]`,
      });
      continue;
    }

    try {
      if (kind === 'image') {
        const base64 = await fetchAsBase64(url);
        if (base64) {
          const mimeType = resolveMimeType(file.type, filename);
          console.log(`[AttachmentProcessor] "${filename}" encoded to base64 (${base64.length} chars, mime=${mimeType})`);
          processed.push({
            type: 'image',
            filename,
            // Grok accepts base64 image content in the message
            content: null,
            inline_data: `data:${mimeType};base64,${base64}`,
          });
        } else {
          console.warn(`[AttachmentProcessor] "${filename}" base64 encoding returned empty result`);
        }
      } else if (kind === 'pdf') {
        const text = await extractPdfText(url);
        if (text) {
          console.log(`[AttachmentProcessor] "${filename}" PDF text extracted (${text.length} chars)`);
          processed.push({
            type: 'document',
            filename,
            content: text.slice(0, 8000), // Cap at 8k chars to avoid token explosion
          });
        } else {
          console.warn(`[AttachmentProcessor] "${filename}" PDF extraction returned no text`);
        }
      } else {
        const text = await fetchRawText(url);
        if (text) {
          console.log(`[AttachmentProcessor] "${filename}" raw text fetched (${text.length} chars)`);
          processed.push({
            type: 'document',
            filename,
            content: text.slice(0, 8000),
          });
        } else {
          console.warn(`[AttachmentProcessor] "${filename}" raw text fetch returned nothing`);
        }
      }
    } catch (err) {
      console.warn(`[AttachmentProcessor] Failed to process "${filename}":`, err.message);
      // Degrade gracefully — include filename reference at minimum
      processed.push({
        type: 'unknown',
        filename,
        content: `[File "${filename}" could not be processed — reference it by name if needed]`,
      });
    }
  }

  console.log('[AttachmentProcessor] Finished. Processed', processed.length, 'of', attachments.length, 'attachments');

  // NEW: enforce the aggregate char budget across everything in this
  // message, on top of the existing per-file 8k cap. Otherwise a message
  // with several large PDFs can balloon token usage well past what any
  // single request should cost.
  const capped = capProcessedAttachments(processed);
  if (capped.length !== processed.length || capped.some((c, i) => c.content !== processed[i]?.content)) {
    console.log('[AttachmentProcessor] Applied aggregate attachment budget cap', {
      before: processed.length,
      after: capped.length,
      maxTotalChars: MAX_TOTAL_ATTACHMENT_CHARS,
    });
  }

  return capped;
};

/**
 * Build the prompt text block that gets appended to the user's message.
 * For images: inserts inline base64 (if model supports vision)
 * For documents: inserts extracted text
 */
export const buildGrokAttachmentPrompt = (processedAttachments) => {
  if (!processedAttachments?.length) {
    console.log('[AttachmentProcessor] buildGrokAttachmentPrompt: nothing to build (empty/undefined processedAttachments)');
    return '';
  }

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

  const prompt = `\n\nATTACHED FILES:\n${parts.join('\n')}`;
  console.log(`[AttachmentProcessor] buildGrokAttachmentPrompt: built prompt block of ${prompt.length} chars for ${processedAttachments.length} attachment(s)`);
  return prompt;
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