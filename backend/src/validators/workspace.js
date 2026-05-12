// src/validators/workspace.js — IMP-05
import { z } from 'zod';
export const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'name is required').max(100),
});
export const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  role:  z.enum(['admin', 'manager', 'member']).optional().default('member'),
});
export const updateRoleSchema = z.object({
  role: z.enum(['admin', 'manager', 'member']),
});
export const transferOwnershipSchema = z.object({
  new_owner_user_id: z.string().uuid('new_owner_user_id must be a valid UUID'),
});
export const nudgeSchema = z.object({
  user_id: z.string().uuid('user_id must be a valid UUID'),
  message: z.string().min(1).max(200, 'Message must be 200 characters or fewer'),
});
