import { describe, it, expect, vi } from 'vitest';

// followupSequenceJob.js pulls in Supabase/Groq/notifications at import
// time — mock them so importing the file for its one pure export doesn't
// require a real Supabase client or network access.
vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../../services/multiProvider.js', () => ({ callWithFallbackGroq: vi.fn() }));
vi.mock('../../services/notifications.js', () => ({ notifyUser: vi.fn() }));

const { matchWorkspaceProfile } = await import('../followupSequenceJob.js');

describe('matchWorkspaceProfile', () => {
  it('picks the workspace_profiles array entry matching the opportunity workspace_id, not the first entry', () => {
    const opp = {
      id: 'opp-1',
      workspace_id: 'ws-correct',
      workspace_profiles: [
        { workspace_id: 'ws-wrong', product_description: 'Wrong product' },
        { workspace_id: 'ws-correct', product_description: 'Correct product' },
      ],
    };

    const result = matchWorkspaceProfile(opp);

    expect(result.product_description).toBe('Correct product');
  });

  it('handles a bare (non-array) workspace_profiles object', () => {
    const opp = {
      id: 'opp-2',
      workspace_id: 'ws-a',
      workspace_profiles: { workspace_id: 'ws-a', product_description: 'Solo' },
    };

    expect(matchWorkspaceProfile(opp)).toEqual({
      workspace_id: 'ws-a',
      product_description: 'Solo',
    });
  });

  it('falls back to the first profile when none match the workspace_id', () => {
    const opp = {
      id: 'opp-3',
      workspace_id: 'ws-missing',
      workspace_profiles: [{ workspace_id: 'ws-other', product_description: 'X' }],
    };

    expect(matchWorkspaceProfile(opp)).toEqual({
      workspace_id: 'ws-other',
      product_description: 'X',
    });
  });
});
