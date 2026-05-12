// src/validators/goals.js
import { z } from 'zod';
export const createGoalSchema = z.object({
  goal_text:    z.string().min(1).max(500),
  goal_type:    z.string().max(50).optional().default('custom'),
  target_value: z.number().positive().optional().nullable(),
  target_unit:  z.string().max(50).optional().nullable(),
  target_date:  z.string().optional().nullable(),
});
export const goalNoteSchema = z.object({
  note_text:      z.string().min(1).max(2000),
  explicit_delta: z.number().optional().nullable(),
});
