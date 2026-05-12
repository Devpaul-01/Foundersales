// src/routes/suggestions.js
// ============================================================
// SUGGESTIONS — WORKSPACE REFACTOR
//
// CHANGES:
//  - Reads product_description and target_audience from
//    workspace_profiles (via req.workspaceProfile) instead of
//    querying users table directly
// ============================================================

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { callGroq } from '../services/groq.js';

const router = Router();

const DEFAULT_SUGGESTIONS = [
  'Help me write a better cold message',
  'Why am I getting ghosted?',
  'Review my outreach approach',
  'What should I say after no response?',
  'Help me handle a price objection',
];

// GET /api/suggestions
router.get('/', asyncHandler(async (req, res) => {
  // WORKSPACE REFACTOR: reads from req.workspaceProfile (set by resolveWorkspace)
  const workspaceProfile = req.workspaceProfile;

  if (!workspaceProfile?.product_description) {
    return res.json({ suggestions: DEFAULT_SUGGESTIONS });
  }

  try {
    const prompt = `You are an AI sales coach assistant.
Based on this founder's profile, suggest 5 quick-start conversation starters that would be most useful for them right now.
Product: ${workspaceProfile.product_description}
Target audience: ${workspaceProfile.target_audience || 'not specified'}
Format: Return ONLY a JSON array of 5 short action phrases (under 8 words each). No preamble.
Example: ["Help me write a cold DM", "What's my best platform?"]`;

    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens:   200,
    });

    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    if (Array.isArray(parsed) && parsed.length >= 3) {
      return res.json({ suggestions: parsed.slice(0, 5) });
    }
  } catch { /* fall through to default */ }

  res.json({ suggestions: DEFAULT_SUGGESTIONS });
}));

export default router;


