// src/validators/opportunities.js
import { z } from 'zod';
import { OPPORTUNITY_STATUS } from '../config/constants.js';

export const listOpportunitiesQuerySchema = z.object({
  status: z.enum([...Object.values(OPPORTUNITY_STATUS), 'all']).optional().default('pending'),
  limit:  z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const updateStatusSchema = z.object({
  status: z.enum(Object.values(OPPORTUNITY_STATUS), {
    errorMap: () => ({ message: `status must be one of: ${Object.values(OPPORTUNITY_STATUS).join(', ')}` }),
  }),
});

export const assignOpportunitySchema = z.object({
  user_id: z.string().uuid('user_id must be a valid UUID'),
});
