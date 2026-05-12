// src/services/streaming.js
// ============================================================
// SERVER-SENT EVENTS (SSE) STREAMING
//
// Default streaming provider is now Groq (via streamGroq).
// Pass streamWithFallback from multiProvider.js for multi-model
// fallback in chat routes.
// ============================================================

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
  } catch {
    // Client disconnected
  }
};

/**
 * End the SSE stream cleanly.
 */
export const endSSE = (res) => {
  try {
    res.write('event: done\ndata: {}\n\n');
    res.end();
  } catch {
    // Already closed
  }
};

/**
 * High-level streaming handler for chat routes.
 *
 * @param {object} opts
 * @param {object}   opts.res          - Express response object
 * @param {string}   opts.systemPrompt - System prompt string
 * @param {Array}    opts.messages     - Message history array
 * @param {string}   opts.chatId       - Chat DB row ID
 * @param {string}   opts.userId       - User DB row ID
 * @param {object}   opts.supabase     - Supabase admin client
 * @param {object}   [opts.metadata]   - Extra fields for the DB row
 * @param {Function} [opts.streamFn]   - Streaming function to use.
 *                                       Defaults to streamGroq (primary model).
 *                                       Pass streamWithFallback from multiProvider.js
 *                                       to enable multi-model fallback.
 */
export const streamAndSave = async ({
  res,
  systemPrompt,
  messages,
  chatId,
  userId,
  supabase,
  metadata = {},
  streamFn = null
}) => {
  // Default to Groq primary model if no override provided
  let streamFunction = streamFn;
  if (!streamFunction) {
    const { streamGroq } = await import('./groq.js');
    streamFunction = streamGroq;
  }

  const { recordTokenUsage } = await import('./tokenTracker.js');

  initSSE(res);

  // Insert placeholder row
  const { data: messageRow, error: insertError } = await supabase
    .from('chat_messages')
    .insert({
      chat_id:         chatId,
      user_id:         userId,
      role:            'assistant',
      content:         '',
      delivery_status: 'sent',
      is_streamed:     true,
      model_used:      metadata.model_used || 'groq',
      ...metadata
    })
    .select()
    .single();

  if (insertError) {
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
    maxTokens:   1200,

    onToken: (token) => {
      if (!clientConnected) return;
      sendSSE(res, 'token', { token });
    },

    onComplete: async (content, usage) => {
      const modelUsed = usage?.model_used || metadata.model_used || 'groq';

      // Guard against saving empty responses — surface a recovery message instead
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
          model_used:      modelUsed
        })
        .eq('id', messageRow.id);

      // ─── Atomic message_count increment ──────────────────────────────────
      // IMPORTANT: The read-then-write pattern (select count → update count+1)
      // has a race condition under concurrent sends. Use an RPC for atomicity.
      //
      // Required Supabase SQL (run once in SQL editor):
      //   CREATE OR REPLACE FUNCTION increment_chat_stats(p_chat_id UUID)
      //   RETURNS void LANGUAGE sql AS $$
      //     UPDATE chats
      //     SET message_count  = COALESCE(message_count, 0) + 1,
      //         last_message_at = NOW()
      //     WHERE id = p_chat_id;
      //   $$;
      //
      const { error: rpcError } = await supabase.rpc('increment_chat_stats', { p_chat_id: chatId });
      if (rpcError) {
        // Fallback: non-atomic update if RPC not yet deployed
        const { data: chat } = await supabase
          .from('chats')
          .select('message_count')
          .eq('id', chatId)
          .single();
        await supabase
          .from('chats')
          .update({
            last_message_at: new Date().toISOString(),
            message_count:   (chat?.message_count || 0) + 1
          })
          .eq('id', chatId);
      }

      const tokensOut = usage?.tokens_out || Math.ceil(finalContent.length / 4);
      await recordTokenUsage(userId, modelUsed, 0, tokensOut);

      if (clientConnected) {
        sendSSE(res, 'complete', {
          message_id:  messageRow.id,
          tokens_used: tokensOut,
          model_used:  modelUsed
        });
        endSSE(res);
      }
    },

    onError: async (err) => {
      console.error('[Stream] Error:', err.message);

      await supabase
        .from('chat_messages')
        .update({ content: '[Message generation failed. Please try again.]' })
        .eq('id', messageRow.id);

      if (clientConnected) {
        sendSSE(res, 'error', { message: 'Generation failed. Please try again.' });
        endSSE(res);
      }
    }
  });
};
