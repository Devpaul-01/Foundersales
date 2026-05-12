import apiClient from './client';
import type { VoiceProfile } from './types';

export const onboardingApi = {
  getStatus: () =>
    apiClient.get<{
      completed:         boolean;
      step:              number;
      has_voice_profile: boolean;
      has_primary_goal:  boolean;
      name:              string | null;
      business_name:     string | null;
    }>('/api/onboarding/status'),

  submitBasic: (body: {
    name?:                string;
    business_name?:       string;
    product_description?: string;
    target_audience?:     string;
    role?:                string;
    industry?:            string;
    experience_level?:    string;
    business_stage?:      string;
    preferred_platforms?: string[];
    primary_goal?:        string;
    country?:             string;
    state?:               string;
    website?:             string;
    bio?:                 string;
  }) =>
    apiClient.post<{ success: boolean }>('/api/onboarding/basic', body),

  getQuestions: () =>
    apiClient.get<{
      questions: Array<{ id: string; question: string }>;
      burst:     number;
      step:      number;
    }>('/api/onboarding/questions'),

  submitAnswers: (body: { answers: Record<string, string>; burst: number }) =>
    apiClient.post<
      | { success: boolean; step: number; complete: false }
      | { success: boolean; voice_profile: VoiceProfile }
    >('/api/onboarding/answers', body),

  submitAbbreviated: (body: { role?: string; primary_goal?: string }) =>
    apiClient.post<{ success: boolean }>('/api/onboarding/abbreviated', body),

  generateSampleMessage: () =>
    apiClient.post<{
      success:              boolean;
      sample_message:       string;
      based_on_opportunity: boolean;
      opportunity_context:  string | null;
      message:              string;
    }>('/api/onboarding/sample-message'),

  updateVoiceProfile: (voiceProfile: VoiceProfile) =>
    apiClient.put<{ success: boolean }>('/api/onboarding/profile', {
      voice_profile: voiceProfile,
    }),

  rebuildVoiceProfile: () =>
    apiClient.post<{ success: boolean; voice_profile: VoiceProfile }>(
      '/api/onboarding/rebuild-voice-profile',
    ),
};
