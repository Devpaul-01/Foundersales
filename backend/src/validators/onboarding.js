// src/validators/onboarding.js
import { z } from 'zod';
export const onboardingBasicSchema = z.object({
  name:               z.string().min(1).max(100).optional(),
  business_name:      z.string().max(200).optional(),
  product_description:z.string().max(2000).optional(),
  target_audience:    z.string().max(1000).optional(),
  role:               z.string().max(50).optional(),
  industry:           z.string().max(50).optional(),
  experience_level:   z.string().max(50).optional(),
  primary_goal:       z.string().max(50).optional(),
  preferred_platforms:z.array(z.string()).optional(),
});
export const onboardingAnswersSchema = z.object({
  answers: z.record(z.any()),
  burst:   z.number().int().min(1).max(3).optional(),
});
