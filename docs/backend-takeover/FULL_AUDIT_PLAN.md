# Full Codebase Audit — Structured Plan

The prior engagement (AUDIT.md) was finding-driven: it went deep wherever something looked wrong, not a systematic
sweep. The person explicitly asked for a full audit instead. This document is that plan: every backend file, a
fixed checklist applied to each, and a place to record the result for every single one — including "reviewed, no
issue found," which is itself a result worth recording, not just silence.

## Inventory (actual, not estimated)

80 source files, ~29,000 lines, as of this audit:
- **Routes** (20): auth, calendar, chat, commitments, feedback, followup, goals, growth, insights, metrics,
  onboarding, opportunities, pipeline, practice, prospects, suggestions, upload, user, workspace-activity,
  workspaces
- **Jobs** (19): backgroundWorker, bullmq, conversationAnalysisJob, coreJobs, emailDigestJob,
  followupSequenceJob, growthIntelligenceScheduler, growthPushNotificationJob, index, memoryExtractionJob,
  messageQueueWorker, patternDetectionJob, patternInsightsJob, practiceWeaknessDetector, practiceWorker, queues,
  registerSchedules, scheduledWorker, skillProgressionJob
- **Services** (26): calendarAiGate, calendarCommitmentsSignals, calendarPrep, email, exa, exaCalendar,
  groq-client, groq-coaching, groq-onboarding, groq-outreach, groq-practice, groq-prompts, groq-session, groq,
  groqCalendarIntelligence, intelligenceReport, multiProvider, notifications, prospectDedup, providerCooldown,
  redis, storage, streaming, tokenTracker, transcription, voiceMemoService
- **Middleware** (5): auth, errorHandler, traceId, validate, workspace
- **Config** (9): bullmq, cloudinary, constants, firebase, limiters, rateLimitStore, sentry, supabase, validateEnv
- **Schemas** (1): calendarAiSchemas
- **Utils** (9): attachmentProcessor, concurrencyGuard, jobHelpers, logger, pagination, parseAIJson, parser,
  providerErrors, reportDegradation
- **Database**: schema.sql (48 tables), migrations/ (16 files)

## Per-file checklist

Applied to every file below, scaled to what's relevant for that file's role (a config file doesn't need an
ownership-scoping check; a route file does):

1. **Authorization / ownership scoping** — does every identifier-based query verify `workspace_id`/`user_id`
   against the resolved request context, not a client-supplied one?
2. **Input validation** — are request bodies/params validated before use? What happens on malformed input?
3. **Error handling** — are errors caught appropriately, logged without leaking internals, and do they produce
   correct HTTP status codes (routes) or propagate correctly (jobs/services)?
4. **Idempotency / concurrency** — for anything that can run more than once (job retries, concurrent requests),
   is duplicate execution safe?
5. **Database interaction correctness** — correct table/column names, correct filter logic, no obvious N+1 or
   unbounded query, transactions used where a multi-step write needs atomicity.
6. **Dead code / unreachable paths** — anything clearly unused.
7. **Consistency with sibling files** — does this file follow the same patterns as similar files already
   reviewed, or does it diverge in a way that looks like a bug rather than a deliberate choice?

## Status legend

- ✅ Reviewed, no issue found
- 🔧 Reviewed, issue found and fixed (see AUDIT.md for the entry)
- 🚩 Reviewed, issue found and flagged, not fixed (ambiguous/protected/needs a decision)
- ⏳ Not yet reviewed

## Tracking table

### Routes (20)
| File | Status | Note |
|---|---|---|
| auth.js | 🔧 | Dead refreshSession() call removed from /logout; sign-out scope ("global") flagged not changed. See AUDIT.md 1.14. |
| calendar.js | ✅ (prior pass) | Reviewed in original engagement's milestones 1-2 |
| chat.js | ✅ (prior pass) | Reviewed in original engagement's milestone 2 |
| commitments.js | 🔧 | Under-scoped update() in generate-message tightened (not exploitable as written, but inconsistent with file's own pattern). See AUDIT.md 1.15. |
| feedback.js | ✅ (prior pass) | Reviewed in original engagement's milestone 2 |
| followup.js | 🔧 | Under-scoped mark-as-viewed update tightened. .or()-on-mutation workaround verified correct, not changed. See AUDIT.md 1.16. |
| goals.js | 🔧 | Real gap: note-delete didn't verify noteId belonged to goalId. Plus consistency tightening + an RPC design note flagged. See AUDIT.md 1.17. |
| growth.js | ✅ (prior pass) | Reviewed in original engagement's milestone 2 |
| insights.js | 🔧 | Large file (1238 lines, ~25 handlers), otherwise very clean. One verified-then-unscoped mutation tightened. See AUDIT.md 1.18. |
| metrics.js | 🔧 | HIGH: real cross-workspace data leak (practice_badges/drills, found twice), fixed. Dead code removed. Self-flagged scoring question resolved. See AUDIT.md 1.19. |
| onboarding.js | 🔧 | Protected file — only trivial whitespace/comment cleanup made. Sharpened the SEED_MEMORY flag from milestone 7 with full context. See AUDIT.md 1.20. |
| opportunities.js | ✅ (prior pass) | Reviewed in original engagement's milestones 1-2 |
| pipeline.js | 🔧 | Two verified-then-unscoped mutations tightened (stage update, assign update). See AUDIT.md 1.21. |
| practice.js | ✅ (prior pass) | Reviewed in original engagement's milestone 2 |
| prospects.js | ✅ | Clean — every mutation correctly scoped, Zod .strict() injection guard, correct route ordering. See AUDIT.md 1.22. |
| suggestions.js | 🔧 | Switched manual JSON.parse to the tested parseJSONArray utility (not a live crash, just more robust/consistent). Noted a two-utility duplication to revisit later. See AUDIT.md 1.23. |
| upload.js | 🔧 (prior pass, partial) | multer usage checked for the CVE fix; full route logic not reviewed |
| user.js | ✅ (prior pass) | Reviewed in original engagement's milestones 1-2, deferred-items pass |
| workspace-activity.js | ⏳ | |
| workspaces.js | ✅ (prior pass) | Reviewed in original engagement's milestones 1-2, deferred-items pass |

### Jobs (19)
| File | Status | Note |
|---|---|---|
| backgroundWorker.js | ✅ (prior pass) | Full idempotency trace, milestone 7 |
| bullmq.js | ✅ (prior pass) | Full fix + review, milestone 1 |
| conversationAnalysisJob.js | ✅ | Clean — correct idempotency, correct trust model for a job, clean JSON-parse pattern. See AUDIT.md 1.24. |
| coreJobs.js | ✅ | Clean — strong idempotency design throughout (atomic compare-and-swap, single-source prep generation). See AUDIT.md 1.25. |
| emailDigestJob.js | 🔧 | HIGH: unescaped AI/user content in raw email HTML, fixed. Also unsafe JSON.parse replaced. See AUDIT.md 1.26. |
| followupSequenceJob.js | 🔧 | Unscoped mutation tightened (weaker surrounding protection than other files — this job sweeps cross-workspace by design). Stale constants.js comment fixed. See AUDIT.md 1.27. |
| growthIntelligenceScheduler.js | 🔧 | Three instances of the same unscoped-query pattern fixed (AI context contamination risk, not a direct leak). See AUDIT.md 1.28. |
| growthPushNotificationJob.js | 🔧 | One unscoped query fixed (notification-logic leak, not data exposure). push_notification_log's user-only design confirmed deliberate. See AUDIT.md 1.29. |
| index.js | ✅ (prior pass) | Reviewed in milestone 3 |
| memoryExtractionJob.js | 🔧 | Five unscoped mutations tightened, two unsafe JSON.parse calls switched to the tested utility. See AUDIT.md 1.30. |
| messageQueueWorker.js | ✅ (prior pass) | Full idempotency trace + dead code removal, milestone 3 |
| patternDetectionJob.js | 🔧 | Now fully read. One unscoped query fixed (AI context contamination). JSON.parse switched. pattern_insights enqueue logic re-confirmed correct. See AUDIT.md 1.31. |
| patternInsightsJob.js | 🔧 | Now fully read — genuinely well-built, good validation of the milestone 3 handler-registration fix. One unscoped mutation tightened. See AUDIT.md 1.32. |
| practiceWeaknessDetector.js | 🚩 | JSON.parse switched. Real cross-file workspace-resolution timing gap flagged, not fixed (spans messageQueueWorker.js too). See AUDIT.md 1.33. |
| practiceWorker.js | ✅ (prior pass) | Reviewed in milestone 3 |
| queues.js | ✅ (prior pass) | Reviewed in milestone 3 |
| registerSchedules.js | ✅ (prior pass) | Reviewed + fixed in milestones 3-4 |
| scheduledWorker.js | ✅ (prior pass) | Reviewed + fixed in milestone 3 |
| skillProgressionJob.js | ✅ | Clean — authoritative source of composite_score_avg, confirms the earlier 0-10 scale trace. See AUDIT.md 1.34. |

### Services (26)
| File | Status | Note |
|---|---|---|
| calendarAiGate.js | ✅ | Clean — well-designed cost-control gate, correctly scoped, consolidates previously-duplicated logic. See AUDIT.md 1.35. |
| calendarCommitmentsSignals.js | 🚩 | Clean implementation. Flagged a stale comment claiming two functions in groqCalendarIntelligence.js are still used elsewhere — grep found zero call sites; to confirm when that file is read. See AUDIT.md 1.36. |
| calendarPrep.js | ✅ | Clean — real, substantial three-way consolidation, correctly scoped throughout. See AUDIT.md 1.37. |
| email.js | 🔧 | HIGH: unescaped user-controlled content in two HTML email templates, fixed (more directly exploitable than the AI-content version). .env.example corrected. See AUDIT.md 1.38. |
| exa.js | 🔧 | Well-architected, explicit scope-boundary reasoning in its own comments. One JSON.parse switched. See AUDIT.md 1.39. |
| exaCalendar.js | ✅ (prior pass) | Fully read for idempotency, milestone 7 |
| groq-client.js | ✅ | Clean — correct selective retry logic, SSE parsing correctly not routed through the AI-JSON utilities. See AUDIT.md 1.40. |
| groq-coaching.js | 🔧 | Well-built prompt logic, no scoping concerns. Five JSON.parse calls switched. Flagged a possible duplication with groq-practice.js to check later. See AUDIT.md 1.41. |
| groq-onboarding.js | 🔧 | Now fully read (protected — only mechanical fixes made). Two JSON.parse calls switched. Confirms the archetype and SEED_MEMORY findings from earlier files. See AUDIT.md 1.42. |
| groq-outreach.js | ⏳ | |
| groq-practice.js | ⏳ | |
| groq-prompts.js | ⏳ | |
| groq-session.js | ⏳ | |
| groq.js | ⏳ | Only generateDailyTips/generateDailyTip/generateMultiAxisScores call sites seen |
| groqCalendarIntelligence.js | ⏳ | Only generatePostMeetingFollowUp's call site seen |
| intelligenceReport.js | ⏳ | |
| multiProvider.js | ⏳ | Only callWithFallbackGroq's call sites seen |
| notifications.js | ⏳ | Only notifyUser's call sites seen |
| prospectDedup.js | ✅ (prior pass) | Fully read for idempotency, milestone 7 |
| providerCooldown.js | ⏳ | |
| redis.js | ✅ (prior pass) | Full fix + live verification, milestone 6 |
| storage.js | ⏳ | |
| streaming.js | ⏳ | |
| tokenTracker.js | ⏳ | |
| transcription.js | ⏳ | Only transcribeAudio's call site seen |
| voiceMemoService.js | ✅ (prior pass) | Fully read for idempotency, milestone 7 |

### Middleware (5)
| File | Status | Note |
|---|---|---|
| auth.js | ✅ (prior pass) | Fully read, milestone 1 |
| errorHandler.js | 🔧 (prior pass, partial) | Checked for multer-specific handling only |
| traceId.js | ⏳ | |
| validate.js | ⏳ | |
| workspace.js | ✅ (prior pass) | Fully read, milestone 1 |

### Config (9)
| File | Status | Note |
|---|---|---|
| bullmq.js | ✅ (prior pass) | Full fix + live verification, milestones 1 and 6 |
| cloudinary.js | ⏳ | |
| constants.js | 🔧 (prior pass, partial) | Only QUEUE_JOB_TYPES/DELIVERY_STATUS/BACKGROUND_JOB_TYPES entries checked |
| firebase.js | ✅ (prior pass) | Fully read, milestone 1 (FIREBASE_SERVICE_ACCOUNT fix) |
| limiters.js | ⏳ | |
| rateLimitStore.js | ⏳ | Only its import of getRawClient seen |
| sentry.js | ⏳ | |
| supabase.js | ✅ (prior pass) | Fully read, milestone 1 |
| validateEnv.js | ✅ (prior pass) | Fully read + fixed, milestone 1 |

### Schemas (1)
| File | Status | Note |
|---|---|---|
| calendarAiSchemas.js | ⏳ | Only imported names seen, not read |

### Utils (9)
| File | Status | Note |
|---|---|---|
| attachmentProcessor.js | ⏳ | |
| concurrencyGuard.js | 🔧 (prior pass, partial) | Head of file read in milestone 1 recon; not fully read |
| jobHelpers.js | ⏳ | |
| logger.js | ⏳ | |
| pagination.js | ✅ (prior pass) | Has existing test coverage, logic not independently re-read |
| parseAIJson.js | ⏳ | |
| parser.js | ✅ (prior pass) | Has existing test coverage, logic not independently re-read |
| providerErrors.js | ✅ (prior pass) | Has existing test coverage, logic not independently re-read |
| reportDegradation.js | ⏳ | |

### Database
| Item | Status | Note |
|---|---|---|
| schema.sql — structure/ordering | ✅ (prior pass) | Verified by live execution, milestone 6 |
| schema.sql — every table's constraints/nullability/FKs individually | ⏳ | Only the tables a specific finding touched were examined closely |
| migrations/ — each file's content vs schema.sql | 🔧 (prior pass, partial) | All checked for presence in schema.sql; content not deeply reviewed beyond that |

## Execution order

Working front-to-back through each ⏳ row above, grouped by directory (routes, then jobs, then services, then the
smaller directories), recording a result for every file — fix if something concrete and in-scope is found, flag if
it needs a decision, mark reviewed-clean otherwise. This plan itself gets updated as each file is completed, so
progress is visible and nothing gets silently skipped.
