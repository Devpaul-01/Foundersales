// src/services/prospectDedup.js
// ============================================================
// PROSPECT DEDUPLICATION ENGINE
//
// Replaces upsertProspect's weak `.ilike('name', ...)` exact-match check
// (case-insensitive equality, NOT fuzzy matching) with a three-layer model:
//
//   Layer 1 — exact identifier match (email / linkedin_url): auto-reuse.
//             Unambiguous; treated as ground truth.
//   Layer 2 — normalized-name exact match (whitespace/case variance only):
//             auto-reuse. Catches "Jane Smith" vs " jane   smith ".
//   Layer 3 — trigram similarity on genuinely different-looking names:
//             NEVER auto-merged. Flagged into prospect_merge_candidates
//             for human review. Auto-merging fuzzy name matches risks
//             incorrectly combining two different real people who share
//             a name — a real failure mode, not a hypothetical one.
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import { createLogger } from '../utils/logger.js';

const { logError } = createLogger('ProspectDedup');

const SIMILARITY_THRESHOLD = 0.45; // tuned conservatively — false negatives here are far cheaper than false positives

const normalizeName = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Resolves an existing prospect via strong identifiers or normalized name,
 * or creates a new one. Fire-and-forget triggers a fuzzy scan for
 * merge-candidate flagging (non-blocking — never delays event creation).
 */
export async function resolveOrCreateProspect(userId, workspaceId, { name, email, context, linkedinUrl }) {
  const trimmedName = name?.trim();
  if (!trimmedName) return null;

  try {
    // Layer 1: strong identifier match
    if (email?.trim() || linkedinUrl?.trim()) {
      let query = supabaseAdmin.from('prospects').select('id').eq('workspace_id', workspaceId).eq('user_id', userId);
      query = email?.trim() ? query.ilike('email', email.trim()) : query.ilike('linkedin_url', linkedinUrl.trim());
      const { data: strongMatch } = await query.limit(1).maybeSingle();
      if (strongMatch) return strongMatch.id;
    }

    // Layer 2: normalized-name exact match
    const normalized = normalizeName(trimmedName);
    const { data: nameMatch } = await supabaseAdmin.from('prospects').select('id')
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('name_normalized', normalized)
      .limit(1).maybeSingle();
    if (nameMatch) return nameMatch.id;

    // No match — create new prospect
    const { data: created, error } = await supabaseAdmin.from('prospects').insert({
      workspace_id: workspaceId,
      user_id: userId,
      name: trimmedName,
      email: email?.trim() || null,
      linkedin_url: linkedinUrl?.trim() || null,
      notes: context?.trim() || null,
      first_contact_at: new Date().toISOString(),
      last_contact_at: new Date().toISOString(),
    }).select('id').single();

    if (error) {
      // Handle a race where two concurrent requests both miss the Layer-2
      // check and both attempt to create the "same" normalized name.
      if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
        const { data: fallback } = await supabaseAdmin.from('prospects').select('id')
          .eq('workspace_id', workspaceId).eq('user_id', userId).eq('name_normalized', normalized)
          .limit(1).maybeSingle();
        return fallback?.id || null;
      }
      throw error;
    }

    // Layer 3: async fuzzy scan, never blocks the caller
    scanForMergeCandidates(workspaceId, created.id, trimmedName).catch((err) =>
      logError('scanForMergeCandidates', err, { workspaceId, prospectId: created.id })
    );

    return created?.id || null;
  } catch (err) {
    logError('resolveOrCreateProspect', err, { userId, workspaceId });
    return null;
  }
}

/**
 * Flags near-duplicate prospects for human review. Never merges
 * automatically — writes into prospect_merge_candidates only.
 */
export async function scanForMergeCandidates(workspaceId, newProspectId, name) {
  const { data: similar, error } = await supabaseAdmin.rpc('find_similar_prospects', {
    p_workspace_id: workspaceId,
    p_prospect_id: newProspectId,
    p_name: name,
    p_threshold: SIMILARITY_THRESHOLD,
  });
  if (error) { logError('find_similar_prospects rpc', error, { workspaceId, newProspectId }); return; }
  if (!similar?.length) return;

  const rows = similar.map((s) => ({
    workspace_id: workspaceId,
    prospect_id_a: newProspectId,
    prospect_id_b: s.id,
    similarity_score: s.similarity,
    match_reason: 'name_similarity',
  }));

  const { error: upsertError } = await supabaseAdmin
    .from('prospect_merge_candidates')
    .upsert(rows, { onConflict: 'prospect_id_a,prospect_id_b', ignoreDuplicates: true });
  if (upsertError) logError('merge_candidates upsert', upsertError, { workspaceId, newProspectId });
}

/**
 * Resolves a pending merge candidate: 'merge' repoints every FK reference
 * from prospect_id_b onto prospect_id_a, then deletes b; 'dismiss' just
 * marks the candidate resolved.
 */
export async function resolveMergeCandidate(workspaceId, candidateId, action, resolvedByUserId) {
  const { data: candidate } = await supabaseAdmin.from('prospect_merge_candidates').select('*')
    .eq('id', candidateId).eq('workspace_id', workspaceId).eq('status', 'pending').single();
  if (!candidate) return { success: false, error: 'NOT_FOUND' };

  if (action === 'merge') {
    const referencingTables = ['user_events', 'conversation_commitments', 'conversation_signals', 'prospect_insights'];
    for (const table of referencingTables) {
      const { error } = await supabaseAdmin.from(table)
        .update({ prospect_id: candidate.prospect_id_a })
        .eq('prospect_id', candidate.prospect_id_b)
        .eq('workspace_id', workspaceId);
      if (error) { logError(`merge repoint ${table}`, error, { candidateId }); return { success: false, error: 'MERGE_FAILED' }; }
    }
    const { error: deleteError } = await supabaseAdmin.from('prospects')
      .delete().eq('id', candidate.prospect_id_b).eq('workspace_id', workspaceId);
    if (deleteError) { logError('merge delete prospect_b', deleteError, { candidateId }); return { success: false, error: 'MERGE_FAILED' }; }
  }

  await supabaseAdmin.from('prospect_merge_candidates').update({
    status: action === 'merge' ? 'merged' : 'dismissed',
    resolved_at: new Date().toISOString(),
    resolved_by: resolvedByUserId,
  }).eq('id', candidateId);

  return { success: true, action };
}

/**
 * Weekly catch-up scan across an entire workspace — for prospects created
 * via a path that predates this dedup engine, or any that slipped through.
 */
export async function runProspectDedupScanForWorkspace(workspaceId) {
  const { data: prospects } = await supabaseAdmin.from('prospects').select('id, name')
    .eq('workspace_id', workspaceId).limit(500);
  for (const p of (prospects || [])) {
    await scanForMergeCandidates(workspaceId, p.id, p.name).catch((err) =>
      logError('scanForMergeCandidates (workspace scan)', err, { workspaceId, prospectId: p.id })
    );
  }
}

/**
 * Scheduled-job entry point (cron, zero-arg): fans out one
 * PROSPECT_DEDUP_SCAN background job per active workspace rather than
 * scanning everything inline in the scheduler's own execution — keeps the
 * scheduled-jobs queue's concurrency:1 lock short-lived, matching the
 * "thin scan-and-enqueue" pattern used for calendar prep.
 */
export async function enqueueDedupScanForAllWorkspaces() {
  const { backgroundQueue } = await import('../jobs/queues.js');
  const { BACKGROUND_JOB_TYPES } = await import('../config/constants.js');

  const { data: workspaces } = await supabaseAdmin.from('workspaces').select('id').eq('is_deleted', false);
  const today = new Date().toISOString().split('T')[0];

  for (const ws of (workspaces || [])) {
    await backgroundQueue.add(
      BACKGROUND_JOB_TYPES.PROSPECT_DEDUP_SCAN,
      { workspaceId: ws.id },
      { jobId: `dedup-scan:${ws.id}:${today}`, attempts: 2, backoff: { type: 'exponential', delay: 5000 } }
    ).catch((err) => logError('enqueue prospect_dedup_scan', err, { workspaceId: ws.id }));
  }
}

export default {
  resolveOrCreateProspect,
  scanForMergeCandidates,
  resolveMergeCandidate,
  runProspectDedupScanForWorkspace,
  enqueueDedupScanForAllWorkspaces,
};
