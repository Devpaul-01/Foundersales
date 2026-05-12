// src/utils/attachmentProcessor.js
// ============================================================
// ATTACHMENT PREPROCESSOR FOR GROQ
// Processes file attachments into prompt-injectable text/data.
//
// Images  → Grok Vision model (llama-3.2-11b-vision-preview)
//           generates a text summary → injected as context
// PDFs    → extract text using pdf-parse
// Docs    → extract raw text
//
// FIX IMAGE: Previously images were fetched as base64 but NOT
// sent to the AI — only a "[Image attached: ...]" placeholder
// was added since Grok's primary model is text-only.
//
// NEW: We now call Groq's vision model to generate a rich text
// summary of each image, then inject that summary into the
// prompt. The main chat model gets real image context.
// ============================================================

import axios from 'axios';

const VISION_MODEL = process.env.GROQ_VISION_MODEL || 'llama-3.2-11b-vision-preview';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Process attachments into a format Groq can understand.
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
        // NEW: Use Groq vision model to generate a text description
        const base64 = await fetchAsBase64(file.public_url);
        if (base64) {
          const summary = await getImageSummaryFromVision(
            base64,
            file.mime_type || 'image/jpeg',
            file.original_filename
          );
          processed.push({
            type:     'image',
            filename: file.original_filename,
            content:  summary,
          });
        }
      } else if (file.file_type === 'pdf') {
        const text = await extractPdfText(file.public_url);
        if (text) {
          processed.push({
            type:     'document',
            filename: file.original_filename,
            content:  text.slice(0, 8000) // Cap to avoid token explosion
          });
        }
      } else if (file.file_type === 'document' || file.file_type === 'text') {
        const text = await fetchRawText(file.public_url);
        if (text) {
          processed.push({
            type:     'document',
            filename: file.original_filename,
            content:  text.slice(0, 8000)
          });
        }
      }
    } catch (err) {
      console.warn(`[AttachmentProcessor] Failed to process ${file.original_filename}:`, err.message);
      // Degrade gracefully — include filename reference at minimum
      processed.push({
        type:     'unknown',
        filename: file.original_filename,
        content:  `[File "${file.original_filename}" could not be processed — reference it by name if needed]`
      });
    }
  }

  return processed;
};

/**
 * Build the prompt text block appended to the user's message.
 * Images now include real AI-generated descriptions.
 * Documents include extracted text.
 */
export const buildGrokAttachmentPrompt = (processedAttachments) => {
  if (!processedAttachments?.length) return '';

  const parts = processedAttachments.map(att => {
    if (att.type === 'image') {
      return `\n--- Image: "${att.filename}" ---\n${att.content || '[Image could not be analyzed]'}\n--- End of image ---`;
    }
    if (att.type === 'document' || att.type === 'pdf') {
      return `\n--- Document: "${att.filename}" ---\n${att.content}\n--- End of document ---`;
    }
    return att.content || '';
  });

  return `\n\nATTACHED FILES:\n${parts.join('\n')}`;
};

// ──────────────────────────────────────────
// INTERNAL: Groq Vision Image Summary
// ──────────────────────────────────────────

/**
 * Use Groq's vision model to generate a text description of an image.
 * The description is then injected into the chat context so the main
 * text-only model can reason about the image.
 *
 * @param {string} base64     - Base64-encoded image data
 * @param {string} mimeType   - MIME type (e.g. 'image/jpeg')
 * @param {string} filename   - Original filename for context
 * @returns {string}          - Text description of the image
 */
const getImageSummaryFromVision = async (base64, mimeType, filename) => {
  const apiKey = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY;
  if (!apiKey) {
    return `[Image "${filename}" attached — Groq API key not configured for vision processing]`;
  }

  const body = {
    model:      VISION_MODEL,
    max_tokens: 400,
    temperature: 0.1,
    messages: [
      {
        role:    'user',
        content: [
          {
            type: 'text',
            text: `Analyze this image and provide a concise, informative description. Focus on:
- Any text, numbers, or data visible in the image
- Charts, graphs, diagrams, or visual data
- Key business or sales-related information
- Screenshots of websites, apps, or conversations
- Any other content relevant to sales outreach or business

Be specific and factual. Filename: "${filename}"`
          },
          {
            type:      'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` }
          }
        ]
      }
    ]
  };

  try {
    const res = await fetch(GROQ_BASE_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn(`[Vision] Groq vision failed (HTTP ${res.status}):`, err?.error?.message);
      // Fall back to a safe placeholder
      return `[Image "${filename}" — vision analysis unavailable: ${err?.error?.message || 'Unknown error'}]`;
    }

    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    return content || `[Image "${filename}" — no description generated]`;

  } catch (err) {
    console.warn('[Vision] Image analysis failed:', err.message);
    return `[Image "${filename}" — could not be analyzed: ${err.message}]`;
  }
};

// ──────────────────────────────────────────
// INTERNAL: File Fetchers
// ──────────────────────────────────────────

const fetchAsBase64 = async (url) => {
  const response = await axios.get(url, {
    responseType:      'arraybuffer',
    timeout:           15000,
    maxContentLength:  10 * 1024 * 1024  // 10MB max
  });
  return Buffer.from(response.data).toString('base64');
};

const extractPdfText = async (url) => {
  try {
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
    const buffer   = Buffer.from(response.data);
    const result   = await pdfParse(buffer);
    return result.text?.trim() || null;
  } catch (err) {
    console.warn('[AttachmentProcessor] PDF parse failed, falling back to raw text:', err.message);
    return await fetchRawText(url);
  }
};

const fetchRawText = async (url) => {
  const response = await axios.get(url, {
    responseType:     'text',
    timeout:          10000,
    maxContentLength: 5 * 1024 * 1024
  });
  return typeof response.data === 'string' ? response.data.trim() : null;
};
