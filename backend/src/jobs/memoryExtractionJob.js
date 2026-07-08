// src/jobs/memoryExtractionJob.js
// ============================================================
// CROSS-SESSION AI MEMORY — EXTRACTION JOB
// Changes from audit:
//  - IMPROVED: Extraction prompt requests fact_category for each fact
//  - IMPROVED: Dedup prompt preserves category when reinforcing
//  - IMPROVED: Insert includes fact_category column
//  - HIGH-05: workspace_id on user_memory insert and reads
//  - MED-10: recordTokenUsage now uses workspaceId (was userId)
//             Both the extraction call and the dedup call were
//             recording at user level, causing workspace token
//             cost reporting to be systematically undercounted.
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import { callWithFallbackGroq } from '../services/multiProvider.js';
import { sleep, logJob } from '../utils/jobHelpers.js';

const MEMORY_CAP = 30;
const BATCH_SIZE = 10;

// ──────────────────────────────────────────
// MAIN JOB ENTRY POINT
// ──────────────────────────────────────────
export const runMemoryExtractionJob = async () => {
  const startTime = Date.now();
  console.log(`[MemoryJob] Starting ${new Date().toISOString()}`);

  try {
    const { data: chats } = await supabaseAdmin
      .from('chats')
      .select(`
        id, user_id, workspace_id, message_count, last_message_at, memory_last_extracted_at,
        users!inner(id, is_deleted, memory_enabled)
      `)
      .gte('message_count', 10)
      .eq('is_archived', false)
      .neq('chat_mode', 'meeting_notes')
      .eq('users.is_deleted', false)
      .or('users.memory_enabled.is.null,users.memory_enabled.eq.true')
      .or('memory_last_extracted_at.is.null,last_message_at.gt.memory_last_extracted_at')
      .limit(BATCH_SIZE);

    if (!chats?.length) {
      console.log('[MemoryJob] No chats need extraction');
      return;
    }

    console.log(`[MemoryJob] Processing ${chats.length} chats`);
    let processed = 0;

    for (const chat of chats) {
      try {
        await extractMemoryForChat(chat);
        processed++;
      } catch (err) {
        console.error(`[MemoryJob] Failed for chat ${chat.id}:`, err.message);
      }
      await sleep(1500);
    }

    await logJob('memory_extraction', 'completed', { processed, duration_ms: Date.now() - startTime });
    console.log(`[MemoryJob] Done — ${processed} chats processed`);

  } catch (err) {
    console.error('[MemoryJob] Fatal:', err.message);
    await logJob('memory_extraction', 'failed', { error_message: err.message });
  }
};

// ──────────────────────────────────────────
// EXTRACT MEMORY FOR ONE CHAT
// ──────────────────────────────────────────
const extractMemoryForChat = async (chat) => {
  const userId      = chat.user_id;
  const workspaceId = chat.workspace_id;

  const { data: messages } = await supabaseAdmin
    .from('chat_messages')
    .select('role, content')
    .eq('chat_id', chat.id)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (!messages?.length) return;

  const transcript = messages
    .reverse()
    .map(m => `${m.role === 'user' ? 'Founder' : 'AI'}: ${m.content}`)
    .join('\n');

  // Read memory scoped to this workspace (HIGH-05)
  const { data: existing } = await supabaseAdmin
    .from('user_memory')
    .select('id, fact, fact_category, reinforcement_count, last_reinforced_at')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('reinforcement_count', { ascending: false });

  const existingFacts = existing || [];
  const existingFactsList = existingFacts.map(f => `- ${f.fact}`).join('\n') || 'None yet.';

  const extractionPrompt = `You are extracting memory facts from a coaching conversation.

EXISTING FACTS (do not repeat these):
${existingFactsList}

CONVERSATION CONTENT:
${transcript}

Extract 2-5 NEW facts that are:
1. SPECIFIC and CONCRETE — must include at least one of: a number, a name, a date, a product name, a platform, an outcome, or a dollar amount
2. PERSONALLY RELEVANT — things Clutch could reference in a future message to show it remembers them
3. NOT already in the existing facts list
4. NOT generic (avoid: "user is a founder", "user does outreach", "user wants more customers")

GOOD facts (specific, referenceable):
- "User said their biggest customer came from a cold DM on LinkedIn"
- "User mentioned their reply rate dropped from 30% to 12% after changing their opener"
- "User is targeting HR managers at companies between 50-200 employees"
- "User said they closed a $2,400 deal last month using a follow-up sequence"
- "User's product costs $89/month and their main competitor is [Name]"

BAD facts (too generic to reference naturally):
- "User wants to improve their outreach"
- "User uses FounderSales for coaching"
- "User is working on their pitch"

CATEGORIES:
win | loss | customer_insight | product | pricing | competitor | target_market | technique | goal | challenge | timeline | personal

Respond ONLY as a JSON array. Maximum 5 facts. If there are no specific facts worth extracting, return [].

Return format:
[
  { "fact": "specific referenceable fact", "category": "category_name" },
  ...
]`;

  const { content: extractContent } = await callWithFallbackGroq({
    systemPrompt: 'You extract founder facts from conversation history. Return only JSON arrays.',
    messages:     [{ role: 'user', content: extractionPrompt }],
    temperature:  0.2,
    maxTokens:    500,
    tier:         'fast',
    workspaceId, userId, sourceJob: 'memory_extraction',
  });

  let newFacts;
  try {
    const clean = extractContent.replace(/```json|```/g, '').trim();
    newFacts = JSON.parse(clean);
    if (!Array.isArray(newFacts)) throw new Error('Not an array');

    newFacts = newFacts.map(f => {
      if (typeof f === 'string') return { fact: f, category: 'business_context' };
      if (f.fact) return { fact: f.fact, category: f.category || 'business_context' };
      return null;
    }).filter(Boolean);
  } catch {
    newFacts = [];
  }

  if (!newFacts.length) {
    await supabaseAdmin
      .from('chats')
      .update({ memory_last_extracted_at: new Date().toISOString() })
      .eq('id', chat.id);
    return;
  }

  let decisions;
  if (existingFacts.length === 0) {
    decisions = newFacts.map(f => ({ fact: f.fact, category: f.category, action: 'insert', replace_id: null }));
  } else {
    const existingList = existingFacts.map((f, i) => `${i + 1}. [${f.fact_category || 'general'}] ${f.fact}`).join('\n');
    const newList      = newFacts.map((f, i) => `${String.fromCharCode(65 + i)}. [${f.category}] ${f.fact}`).join('\n');

    const dedupPrompt = `You are a memory deduplication system.

EXISTING FACTS (numbered):
${existingList}

NEW FACTS TO EVALUATE (lettered):
${newList}

For each new fact, decide:
- "skip" + replace_id: if a numbered fact already covers this (reinforce it)
- "replace" + replace_id: if a numbered fact is outdated and this is a better version
- "insert": if this is genuinely new information

Return ONLY a JSON array:
[
  { "letter": "A", "action": "skip"|"replace"|"insert", "replace_id": <number or null>, "fact": "fact text", "category": "category_name" },
  ...
]`;

    const { content: dedupContent } = await callWithFallbackGroq({
      systemPrompt: 'You deduplicate memory facts. Return only JSON arrays.',
      messages:     [{ role: 'user', content: dedupPrompt }],
      temperature:  0.1,
      maxTokens:    400,
      tier:         'fast',
      workspaceId, userId, sourceJob: 'memory_dedup',
    });

    try {
      const clean = dedupContent.replace(/```json|```/g, '').trim();
      decisions   = JSON.parse(clean);
    } catch {
      decisions = newFacts.map(f => ({ action: 'insert', fact: f.fact, category: f.category, replace_id: null }));
    }
  }

  for (const decision of (decisions || [])) {
    try {
      if (decision.action === 'skip' && decision.replace_id) {
        const target = existingFacts[decision.replace_id - 1];
        if (target) {
          await supabaseAdmin
            .from('user_memory')
            .update({
              reinforcement_count: (target.reinforcement_count || 1) + 1,
              last_reinforced_at:  new Date().toISOString(),
            })
            .eq('id', target.id);
        }
      } else if (decision.action === 'replace' && decision.replace_id) {
        const target = existingFacts[decision.replace_id - 1];
        if (target) {
          await supabaseAdmin
            .from('user_memory')
            .update({
              fact:                decision.fact,
              fact_category:       decision.category || target.fact_category,
              reinforcement_count: (target.reinforcement_count || 1) + 1,
              last_reinforced_at:  new Date().toISOString(),
            })
            .eq('id', target.id);
        }
      } else if (decision.action === 'insert') {
        const activeCount = existingFacts.filter(f => f.is_active !== false).length;
        if (activeCount >= MEMORY_CAP) {
          await evictLowestPriorityFact(userId, workspaceId, existingFacts);
        }
        // HIGH-05: workspace_id included on insert
        await supabaseAdmin.from('user_memory').insert({
          user_id:        userId,
          workspace_id:   workspaceId,
          fact:           decision.fact,
          fact_category:  decision.category || 'business_context',
          source_chat_id: chat.id,
        });
      }
    } catch (err) {
      console.warn(`[MemoryJob] Decision apply failed for user ${userId}:`, err.message);
    }
  }

  await supabaseAdmin
    .from('chats')
    .update({ memory_last_extracted_at: new Date().toISOString() })
    .eq('id', chat.id);
};

// ──────────────────────────────────────────
// EVICT LOWEST-PRIORITY FACT
// ──────────────────────────────────────────
const evictLowestPriorityFact = async (userId, workspaceId, facts) => {
  const now = Date.now();

  const factIds = facts.map(f => f.id);
  const { data: fullFacts } = await supabaseAdmin
    .from('user_memory')
    .select('id, reinforcement_count, last_reinforced_at, source_chat_id')
    .in('id', factIds)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);

  const chatIds = [...new Set((fullFacts || []).map(f => f.source_chat_id).filter(Boolean))];
  let chatTypeMap = {};
  if (chatIds.length > 0) {
    const { data: chats } = await supabaseAdmin
      .from('chats')
      .select('id, chat_type')
      .in('id', chatIds);
    (chats || []).forEach(c => { chatTypeMap[c.id] = c.chat_type; });
  }

  const fullFactMap = {};
  (fullFacts || []).forEach(f => { fullFactMap[f.id] = f; });

  const scored = facts.map(f => {
    const ff = fullFactMap[f.id] || f;
    const daysSince = (now - new Date(ff.last_reinforced_at || Date.now()).getTime()) / 86400000;
    const recencyScore = Math.min(10, 10 / Math.max(daysSince, 0.1));
    const sourceChatType = ff.source_chat_id ? chatTypeMap[ff.source_chat_id] : null;
    const sourceDiversity = sourceChatType ? 1 : 0;
    const priority = (ff.reinforcement_count * 3) + (recencyScore * 1) + (sourceDiversity * 2);
    return { ...f, priority };
  });

  scored.sort((a, b) => a.priority - b.priority);
  const toEvict = scored[0];

  if (toEvict) {
    await supabaseAdmin
      .from('user_memory')
      .update({ is_active: false })
      .eq('id', toEvict.id);
  }
};
