// src/validators/practice.js
import { z } from 'zod';
export const startPracticeSchema = z.object({
  scenario_type:     z.string().optional(),
  opportunity_id:    z.string().uuid().optional().nullable(),
  session_goal:      z.string().max(500).optional().nullable(),
  pressure_modifier: z.string().optional().nullable(),
  custom_product:    z.string().max(1000).optional().nullable(),
});
export const practiceMessageSchema = z.object({
  message:     z.string().min(1).max(5000),
  attachments: z.array(z.any()).optional().default([]),
});
