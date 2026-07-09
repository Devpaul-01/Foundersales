// src/services/streaming.js
// ============================================================
// SERVER-SENT EVENTS (SSE) STREAMING
//
// Default streaming provider is now Groq (via streamGroq).
// Pass streamWithFallback from multiProvider.js for multi-model
// fallback in chat routes.
//
// CHAT AUDIT CHANGES:
//   - increment_chat_stats is now called with ONLY p_chat_id (confirmed
//     single-param signature) everywhere — this file already called it
//     that way; chat.js's callers (which were passing an extra
//     p_increment) have been corrected to match (audit §4.3).
//   - onError now sets delivery_status: 'failed' on the message row
//     instead of leaving it at 'sent', so failed generations are
//     distinguishable from genuinely delivered ones in the DB (audit §6,
//     low-priority polish item).
//   - Accepts an optional `citations` array + `images` array, threaded
//     through from chat.js, so:
//       * citations (from Exa search) get persisted on the assistant
//         row instead of being computed and discarded (audit §5.6/§7.1)
//       * images (vision-capable current-turn attachments) get forwarded
//         to streamWithFallback so a vision model can actually see them
//         (audit §5.8)
//   - maxTokens now defaults from the shared CHAT_MAX_TOKENS constant
//     instead of a hardcoded 1200, aligning with the non-streaming path
//     which was hardcoded to 800 (audit §5.4).
// ============================================================

import { CHAT_MAX_TOKENS } from '../config/constants.js';

/**
 * Initialize SSE response headers.
 */
export const initSSE = (res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
};

/**
 * Send a typed SSE event.
 */
export const sendSSE = (res, event, data) => {
  try {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${event}\ndata: ${payload}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  } catch (err) {
    // Client disconnected — not actionable, but worth a trace-level note
    // rather than a fully silent catch (audit "no empty except blocks").
    console.warn('[Streaming] sendSSE write failed (client likely disconnected):', err.message);
  }
};

/**
 * End the SSE stream cleanly.
 */
export const endSSE = (res) => {
  try {
    res.write('event: done\ndata: {}\n\n');
    res.end();
  } catch (err) {
    console.warn('[Streaming] endSSE failed (stream likely already closed):', err.message);
  }
};

/**
 * High-level streaming handler for chat routes.
 *
 * @param {object}   opts
 * @param {object}   opts.res          - Express response object
 * @param {string}   opts.systemPrompt - System prompt string
 * @param {Array}    opts.messages     - Message history array
 * @param {string}   opts.chatId       - Chat DB row ID
 * @param {string}   opts.userId       - User DB row ID
 * @param {string}   opts.workspaceId  - Workspace DB row ID
 * @param {object}   opts.supabase     - Supabase admin client
 * @param {object}   [opts.metadata]   - Extra fields for the DB row
 * @param {string}   [opts.tier]       - Workspace plan tier
 * @param {string}   [opts.sourceJob]  - Label forwarded to recordGroqUsage
 * @param {Function} [opts.streamFn]   - Streaming function (defaults to streamGroq)
 * @param {Array}    [opts.citations]  - Search citations to persist on the row (audit §5.6)
 * @param {Array}    [opts.images]     - Current-turn image attachments to forward to
 *                                       vision-capable models (audit §5.8)
 * @param {Function}  [opts.onSaved]   - Optional callback fired with the final saved
 *                                       message row, so callers (chat.js) can trigger
 *                                       follow-up bookkeeping like summarization checks
 *                                       without streaming.js needing to know about it.
 */
export const streamAndSave = async ({
  res,
  systemPrompt,
  messages,
  chatId,
  userId,
  workspaceId,
  supabase,
  metadata = {},
  tier = null,
  sourceJob = 'chat_stream',
  streamFn = null,
  citations = [],
  images = undefined,
  onSaved = null,
}) => {
  let streamFunction = streamFn;
  if (!streamFunction) {
    const { streamGroq } = await import('./groq.js');
    streamFunction = streamGroq;
  }

  const { recordGroqUsage } = await import('./tokenTracker.js');

  initSSE(res);

  const { data: messageRow, error: insertError } = await supabase
    .from('chat_messages')
    .insert({
      chat_id:         chatId,
      user_id:         userId,
      workspace_id:    workspaceId,
      role:            'assistant',
      content:         '',
      delivery_status: 'sent',
      is_streamed:     true,
      model_used:      metadata.model_used || 'pending',
      citations:       citations?.length ? citations : [],
      ...metadata,
    })
    .select()
    .single();

  if (insertError) {
    console.error('[Streaming] Failed to insert placeholder message:', insertError.message);
    sendSSE(res, 'error', { message: 'Failed to initialize message' });
    endSSE(res);
    return;
  }

  sendSSE(res, 'message_id', { id: messageRow.id });

  let clientConnected = true;
  res.on('close', () => { clientConnected = false; });

  await streamFunction({
    systemPrompt,
    messages,
    temperature: 0.7,
    maxTokens:   CHAT_MAX_TOKENS,
    images,

    onToken: (token) => {
      if (!clientConnected) return;
      sendSSE(res, 'token', { token });
    },

    onComplete: async (content, usage) => {
      const modelUsed = usage?.model_used || metadata.model_used || 'unknown';

      const finalContent = content?.trim()
        ? content
        : '[Message generation returned an empty response. Please try again.]';

      await supabase
        .from('chat_messages')
        .update({
          content:         finalContent,
          tokens_used:     usage?.tokens_out || 0,
          delivered_at:    new Date().toISOString(),
          delivery_status: 'delivered',
          model_used:      modelUsed,
        })
        .eq('id', messageRow.id);

      // ─── Atomic message_count increment ──────────────────────────
      // FIX (audit §4.3): increment_chat_stats() takes ONLY p_chat_id.
      // chat.js's callers previously passed a second p_increment param
      // against what may be a different deployed signature — corrected
      // there; this file was already calling it correctly and is
      // unchanged in that respect.
      const { error: rpcError } = await supabase.rpc('increment_chat_stats', { p_chat_id: chatId });
      if (rpcError) {
        console.error('[Streaming] increment_chat_stats RPC failed, falling back to non-atomic update:', rpcError.message);
        const { data: chat } = await supabase
          .from('chats')
          .select('message_count')
          .eq('id', chatId)
          .single();
        await supabase
          .from('chats')
          .update({
            last_message_at: new Date().toISOString(),
            message_count:   (chat?.message_count || 0) + 1,
          })
          .eq('id', chatId);
      }

      const tokensOut = usage?.tokens_out || Math.ceil(finalContent.length / 4);
      await recordGroqUsage({
        workspaceId,
        userId,
        model:     modelUsed,
        tier,
        tokensIn:  usage?.tokens_in || 0,
        tokensOut,
        sourceJob,
        metadata:  { chatId, message_id: messageRow.id },
      });

      if (clientConnected) {
        sendSSE(res, 'complete', {
          message_id:  messageRow.id,
          tokens_used: tokensOut,
          model_used:  modelUsed,
          citations:   citations?.length ? citations : [],
        });
        endSSE(res);
      }

      if (typeof onSaved === 'function') {
        try {
          await onSaved({ id: messageRow.id, chatId, workspaceId, userId });
        } catch (err) {
          console.error('[Streaming] onSaved callback failed:', err.message);
        }
      }
    },

    onError: async (err) => {
      console.error('[Stream] Error:', err.message);

      await supabase
        .from('chat_messages')
        .update({
          content:         '[Message generation failed. Please try again.]',
          delivery_status: 'failed',
        })
        .eq('id', messageRow.id);

      if (clientConnected) {
        sendSSE(res, 'error', { message: 'Generation failed. Please try again.' });
        endSSE(res);
      }
    },
  });
};
