// src/services/groq.js
// ============================================================
// BARREL FILE — Re-exports everything from the split modules so
// all existing imports in routes and elsewhere continue to work
// unchanged. Add new exports here as modules grow.
//
// Each sub-module is imported exactly ONCE. The named exports
// and the default object both reference the same imported
// bindings — no second import pass at startup.
// ============================================================

// ── Core API ────────────────────────────────────────────────
import {
  callGroq,
  streamGroq,
  PRIMARY_MODEL,
  PRO_MODEL,
  FLASH_MODEL,
} from './groq-client.js';

// ── Prompts & helpers ────────────────────────────────────────
import {
  getUserLabel,
  getContactLabel,
  archetypeFocus,
  buildChatSystemPrompt,
  SYSTEM_PROMPTS,
  PRESSURE_MODIFIER_BLOCKS,
  getRoleAwareCoachPrompt,
  getGrowthStrategistPrompt,
} from './groq-prompts.js';

// ── Onboarding ───────────────────────────────────────────────
import {
  buildVoiceProfile,
  generateNextBurst,
  generateBurst1Questions,
  seedMemoryFromOnboarding,
  generateSampleOutreachMessage,
  detectUserArchetype,
} from './groq-onboarding.js';

// ── Outreach ─────────────────────────────────────────────────
import {
  generateOutreachMessage,
  scoreOpportunities,
  evaluateMessageStrength,
  summarizePerformancePatterns,
  generateEventPrep,
  generateCompetitorContext,
} from './groq-outreach.js';

// ── Practice simulation ──────────────────────────────────────
import {
  parseV3Reply,
  splitIntoChunks,
  computeThinkingDelay,
  generatePracticeScenarioPrompt,
  generatePracticeScenarioFromOpportunity,
  generateBuyerProfile,
  generatePracticeProspectReply,
  evaluateBuyerStateChange,
  evaluateMessageQualityForGhost,
  generatePracticeProspectReplyV2,
  generatePracticeProspectReplyV3,
  generatePracticeInterruption,
} from './groq-practice.js';

// ── Coaching & daily flow ────────────────────────────────────
import {
  getCoachResponse,
  generateCoachingTip,
  generateReflectionContext,
  generateDailyTips,
  generateDailyTip,
  generateCheckInQuestions,
  generateCheckInResponse,
  generateWeeklyPlan,
} from './groq-coaching.js';

// ── Session analysis ─────────────────────────────────────────
import {
  generateSessionDebrief,
  generateSessionDebriefV3,
  generateCoachingAnnotations,
  generateMultiAxisScores,
  generateMultiAxisScoresV3,
  generateAdaptiveCurriculum,
  generatePlaybook,
  generateRetryComparison,
} from './groq-session.js';

// ── Named re-exports (for consumers using: import { callGroq } from './groq.js') ──
export {
  // Core
  callGroq, streamGroq, PRIMARY_MODEL, PRO_MODEL, FLASH_MODEL,
  // Prompts
  getUserLabel, getContactLabel, archetypeFocus, buildChatSystemPrompt,
  SYSTEM_PROMPTS, PRESSURE_MODIFIER_BLOCKS, getRoleAwareCoachPrompt, getGrowthStrategistPrompt,
  // Onboarding
  buildVoiceProfile, generateNextBurst, generateBurst1Questions,
  seedMemoryFromOnboarding, generateSampleOutreachMessage, detectUserArchetype,
  // Outreach
  generateOutreachMessage, scoreOpportunities, evaluateMessageStrength,
  summarizePerformancePatterns, generateEventPrep, generateCompetitorContext,
  // Practice
  parseV3Reply, splitIntoChunks, computeThinkingDelay,
  generatePracticeScenarioPrompt, generatePracticeScenarioFromOpportunity,
  generateBuyerProfile, generatePracticeProspectReply, evaluateBuyerStateChange,
  evaluateMessageQualityForGhost, generatePracticeProspectReplyV2,
  generatePracticeProspectReplyV3, generatePracticeInterruption,
  // Coaching
  getCoachResponse, generateCoachingTip, generateReflectionContext,
  generateDailyTips, generateDailyTip, generateCheckInQuestions,
  generateCheckInResponse, generateWeeklyPlan,
  // Session
  generateSessionDebrief, generateSessionDebriefV3, generateCoachingAnnotations,
  generateMultiAxisScores, generateMultiAxisScoresV3, generateAdaptiveCurriculum,
  generatePlaybook, generateRetryComparison,
};

// ── Default export (for consumers using: import groqService from './groq.js') ──
// References the already-imported bindings above — no second import pass.
export default {
  // Core
  callGroq, streamGroq, PRIMARY_MODEL, PRO_MODEL, FLASH_MODEL,
  
  // Prompts (ALL)
  getUserLabel, getContactLabel, archetypeFocus, buildChatSystemPrompt,
  SYSTEM_PROMPTS, PRESSURE_MODIFIER_BLOCKS, getRoleAwareCoachPrompt, getGrowthStrategistPrompt,
  
  // Onboarding
  buildVoiceProfile, generateNextBurst, generateBurst1Questions,
  seedMemoryFromOnboarding, generateSampleOutreachMessage, detectUserArchetype,
  
  // Outreach (ALL - was completely missing)
  generateOutreachMessage, scoreOpportunities, evaluateMessageStrength,
  summarizePerformancePatterns, generateEventPrep, generateCompetitorContext,
  
  // Practice (ALL)
  parseV3Reply, splitIntoChunks, computeThinkingDelay,
  generatePracticeScenarioPrompt, generatePracticeScenarioFromOpportunity,
  generateBuyerProfile, generatePracticeProspectReply, evaluateBuyerStateChange,
  evaluateMessageQualityForGhost, generatePracticeProspectReplyV2,
  generatePracticeProspectReplyV3, generatePracticeInterruption,
  
  // Coaching
  getCoachResponse, generateCoachingTip, generateReflectionContext,
  generateDailyTips, generateDailyTip, generateCheckInQuestions,
  generateCheckInResponse, generateWeeklyPlan,
  
  // Session
  generateSessionDebrief, generateSessionDebriefV3, generateCoachingAnnotations,
  generateMultiAxisScores, generateMultiAxisScoresV3, generateAdaptiveCurriculum,
  generatePlaybook, generateRetryComparison,
}
