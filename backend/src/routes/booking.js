// src/routes/booking.js
// ============================================================
// BOOKING PAGES — native Calendly-equivalent.
//
// Two route groups:
//   bookingPagesRouter  — authenticated, owner managing their own page
//   publicBookingRouter — PUBLIC, unauthenticated (the whole point of a
//                         booking page is that a prospect with no
//                         Foundersales account can book time)
//
// No calendar-sync dependency — this is a standalone Foundersales-native
// feature. Booked meetings flow through resolveOrCreateProspect exactly
// like any other attendee-bearing event.
//
// Mount both routers in your app entrypoint, e.g.:
//   app.use('/api/booking-pages', authMiddleware, bookingPagesRouter);
//   app.use('/api/booking', publicBookingRouter); // NO auth middleware
// ============================================================

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { resolveOrCreateProspect } from '../services/prospectDedup.js';
import { backgroundQueue } from '../jobs/queues.js';
import { BACKGROUND_JOB_TYPES } from '../config/constants.js';
import supabaseAdmin from '../config/supabase.js';

export const bookingPagesRouter = Router(); // authenticated
export const publicBookingRouter = Router(); // public

// ── Authenticated: manage your own booking page + availability ─────────

bookingPagesRouter.get('/', asyncHandler(async (req, res) => {
  const { data: page } = await supabaseAdmin.from('booking_pages').select('*')
    .eq('workspace_id', req.workspace.id).eq('user_id', req.user.id).maybeSingle();
  const { data: windows } = await supabaseAdmin.from('availability_windows').select('*')
    .eq('workspace_id', req.workspace.id).eq('user_id', req.user.id);
  res.json({ booking_page: page, availability_windows: windows || [] });
}));

bookingPagesRouter.post('/', asyncHandler(async (req, res) => {
  const { slug, title, duration_minutes, buffer_minutes, max_days_ahead } = req.body;
  if (!slug?.trim()) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'slug is required' });

  const { data: page, error } = await supabaseAdmin.from('booking_pages').upsert({
    workspace_id: req.workspace.id, user_id: req.user.id,
    slug: slug.trim().toLowerCase(),
    title: title || 'Book a meeting',
    duration_minutes: duration_minutes || 30,
    buffer_minutes: buffer_minutes ?? 10,
    max_days_ahead: max_days_ahead || 30,
  }, { onConflict: 'workspace_id,user_id' }).select().single();

  if (error) {
    if (error.message?.includes('unique')) {
      return res.status(409).json({ error: 'SLUG_TAKEN', message: 'That URL is already in use.' });
    }
    throw error;
  }
  res.status(201).json({ booking_page: page });
}));

bookingPagesRouter.put('/availability', asyncHandler(async (req, res) => {
  const { windows } = req.body; // [{ day_of_week, start_time, end_time, timezone }]
  const workspaceId = req.workspace.id, userId = req.user.id;

  await supabaseAdmin.from('availability_windows').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
  if (windows?.length) {
    const { error } = await supabaseAdmin.from('availability_windows').insert(
      windows.map(w => ({ workspace_id: workspaceId, user_id: userId, ...w }))
    );
    if (error) throw error;
  }
  res.json({ success: true });
}));

// ── Public: view slots + book ────────────────────────────────────────

const timesOverlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

publicBookingRouter.get('/:slug/slots', asyncHandler(async (req, res) => {
  const { date } = req.query; // YYYY-MM-DD
  if (!date) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'date is required' });

  const { data: page } = await supabaseAdmin.from('booking_pages').select('*').eq('slug', req.params.slug).eq('is_active', true).single();
  if (!page) return res.status(404).json({ error: 'NOT_FOUND' });

  const dayOfWeek = new Date(date).getDay();
  const { data: windows } = await supabaseAdmin.from('availability_windows').select('*')
    .eq('workspace_id', page.workspace_id).eq('user_id', page.user_id).eq('day_of_week', dayOfWeek).eq('is_active', true);
  if (!windows?.length) return res.json({ slots: [] });

  const { data: existingEvents } = await supabaseAdmin.from('user_events').select('start_time, end_time')
    .eq('workspace_id', page.workspace_id).eq('user_id', page.user_id).eq('event_date', date);

  const slots = [];
  for (const w of windows) {
    let cursor = new Date(`${date}T${w.start_time}`);
    const windowEnd = new Date(`${date}T${w.end_time}`);
    const durationMs = page.duration_minutes * 60000;
    const bufferMs = page.buffer_minutes * 60000;

    while (cursor.getTime() + durationMs <= windowEnd.getTime()) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor.getTime() + durationMs);
      const bufferedStart = new Date(slotStart.getTime() - bufferMs);
      const bufferedEnd = new Date(slotEnd.getTime() + bufferMs);

      const conflicts = (existingEvents || []).some(e =>
        e.start_time && e.end_time && timesOverlap(bufferedStart, bufferedEnd, new Date(e.start_time), new Date(e.end_time))
      );
      if (!conflicts) slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });

      cursor = new Date(cursor.getTime() + durationMs);
    }
  }

  res.json({ slots, timezone: windows[0].timezone });
}));

publicBookingRouter.post('/:slug/book', asyncHandler(async (req, res) => {
  const { start_time, end_time, name, email, notes } = req.body;
  if (!start_time || !name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'start_time, name, and email are required' });
  }

  const { data: page } = await supabaseAdmin.from('booking_pages').select('*').eq('slug', req.params.slug).eq('is_active', true).single();
  if (!page) return res.status(404).json({ error: 'NOT_FOUND' });

  const prospectId = await resolveOrCreateProspect(page.user_id, page.workspace_id, {
    name: name.trim(), email: email.trim(), context: notes?.trim() || null,
  });

  const { data: event, error } = await supabaseAdmin.from('user_events').insert({
    workspace_id: page.workspace_id,
    user_id: page.user_id,
    title: `Booked call with ${name.trim()}`,
    event_date: start_time.split('T')[0],
    start_time,
    end_time: end_time || null,
    event_type: 'call',
    attendee_name: name.trim(),
    attendee_context: notes?.trim() || null,
    prospect_id: prospectId,
    prospect_auto_created: !!prospectId,
  }).select().single();

  if (error) throw error;

  await backgroundQueue.add(
    BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE,
    { userId: page.user_id, workspaceId: page.workspace_id, eventId: event.id, source: 'booking_page' },
    { jobId: `prep:${event.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );

  res.status(201).json({ success: true, event_id: event.id });
}));

export default { bookingPagesRouter, publicBookingRouter };
