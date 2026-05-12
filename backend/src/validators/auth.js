// src/validators/auth.js
import { z } from 'zod';
export const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
});
export const registerSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
  name:     z.string().min(1).max(100).optional(),
});
