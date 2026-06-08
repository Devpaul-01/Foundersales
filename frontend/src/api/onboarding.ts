import apiClient from './client';
import type { VoiceProfile } from './types';

export const onboardingApi = {
  getStatus: (params?: { _t?: number }) =>
    apiClient.get<{
      completed: boolean;
      step: number;
      has_voice_profile: boolean;
      has_primary_goal: boolean;
      name: string | null;
      business_name: string | null;
    }>('/api/onboarding/status', { params }),

  submitBasic: (body: {
    name?: string;
    business_name?: string;
    product_description?: string;
    target_audience?: string;
    role?: string;
    industry?: string;
    experience_level?: string;
    business_stage?: string;
    preferred_platforms?: string[];
    primary_goal?: string;
    country?: string;
    state?: string;
    website?: string;
    websites?: string[];
    bio?: string;
  }) => apiClient.post<{ success: boolean }>('/api/onboarding/basic', body),

  getQuestions: () =>
    apiClient.get<{
      questions: Array<{ id: string; question: string }>;
      burst: number;
      step: number;
    }>('/api/onboarding/questions'),

  getVoiceProfile: () =>
    apiClient.get<{
      voice_profile: VoiceProfile;
      onboarding_completed: boolean;
    }>('/api/onboarding/voice-profile'),

  // ✅ Main update method (partial updates)
  updateVoiceProfile: (updates: Partial<VoiceProfile>) =>
    apiClient.put<{
      success: boolean;
      voice_profile: VoiceProfile;
      message: string;
    }>('/api/onboarding/voice-profile', updates),

  // ✅ Regenerate from answers
  rebuildVoiceProfile: () =>
    apiClient.post<{
      success: boolean;
      voice_profile: VoiceProfile;
      message: string;
    }>('/api/onboarding/rebuild-voice-profile'),

  submitAnswers: (body: { answers: Record<string, string>; burst: number }) =>
    apiClient.post<
      | { success: boolean; step: number; complete: false }
      | { success: boolean; voice_profile: VoiceProfile }
    >('/api/onboarding/answers', body),

  /**
   * Abbreviated onboarding — called when an invited user skips the full flow.
   * Saves whichever fields are provided; all are optional except primary_goal
   * is strongly recommended (the UI enforces it).
   */
  submitAbbreviated: (body: {
    name?: string;
    role?: string;
    primary_goal?: string;
    experience_level?: string;
    bio?: string;
    websites?: string[];
  }) => apiClient.post<{ success: boolean }>('/api/onboarding/abbreviated', body),

  generateSampleMessage: () =>
    apiClient.post<{
      success: boolean;
      sample_message: string;
      based_on_opportunity: boolean;
      opportunity_context: string | null;
      message: string;
    }>('/api/onboarding/sample-message'),
};
