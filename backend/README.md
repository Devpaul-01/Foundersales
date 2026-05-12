# Clutch AI - Backend Architecture

## Project Structure

```
clutch-backend/
├── src/
│   ├── config/
│   │   ├── constants.js     # All limits, enums, intervals
│   │   ├── supabase.js      # DB client (admin + user-scoped)
│   │   └── firebase.js      # Push notification client
│   ├── middleware/
│   │   ├── auth.js          # JWT verification, attaches req.user
│   │   └── errorHandler.js  # Global error catching + asyncHandler
│   ├── services/
│   │   ├── grok.js          # FREE model - all AI tasks, no limits
│   │   ├── perplexity.js    # Paid search - has daily limits + Grok fallback
│   │   └── notifications.js # Firebase push notifications
│   ├── routes/
│   │   ├── onboarding.js    # Profile setup, AI question generation
│   │   ├── opportunities.js # Feed display, action tracking
│   │   ├── feedback.js      # Positive/negative outcomes, practice suggestion
│   │   ├── practice.js      # Rejection training scenarios
│   │   ├── metrics.js       # Dashboard stats, API usage
│   │   └── coach.js         # AI chat - Grok, no limits
│   ├── jobs/
│   │   └── index.js         # All cron jobs (opportunity, feedback, summary, metrics)
│   └── app.js               # Express entry point
├── schema.sql               # Full Supabase schema with RLS
├── .env.example             # Environment variables template
└── package.json
```

## API Reference

All routes require `Authorization: Bearer <supabase_jwt>` unless marked public.

### Onboarding
```
POST /api/onboarding/basic          # Save basic info, get AI follow-up questions
POST /api/onboarding/answers        # Save { "question": "answer" } pairs, builds voice profile
GET  /api/onboarding/status         # Get current onboarding progress
PUT  /api/onboarding/profile        # Update voice profile
```

### Opportunities
```
GET  /api/opportunities             # Get feed (?status=active&limit=20&offset=0)
POST /api/opportunities/refresh     # Manually fetch new leads (respects limits)
PUT  /api/opportunities/:id/view    # Mark as viewed
PUT  /api/opportunities/:id/click   # Track link click
PUT  /api/opportunities/:id/copy    # Track message copy
PUT  /api/opportunities/:id/sent    # Confirm sent (schedules 48h feedback prompt)
POST /api/opportunities/:id/regenerate  # Generate different message (Grok - free)
```

### Feedback
```
POST /api/feedback                  # Submit { outcome: 'positive'|'negative', outcome_note: '...' }
POST /api/feedback/practice-accepted  # Track when user accepts practice suggestion
GET  /api/feedback/pending          # Opportunities awaiting feedback (48h+ old)
GET  /api/feedback/history          # Full feedback history with stats
```

### Practice Mode
```
GET  /api/practice/scenarios        # Available scenarios + user stats + badges
POST /api/practice/start            # Start session (scenario_type optional)
POST /api/practice/:sessionId/respond  # Submit practice message, get AI response + coaching
GET  /api/practice/stats            # Full practice history
```

### Metrics
```
GET  /api/metrics/dashboard         # 30-day stats, chart data, streak, insights
GET  /api/metrics/usage             # Perplexity limits, Grok usage (unlimited)
```

### Coach
```
POST /api/coach/ask                 # { question, conversation_history[] } - Grok, no limits
```

## Core Design Decisions

### 1. AI Response Parsing (src/utils/parser.js)
Six-attempt cascade: direct parse → strip markdown → extract object → extract array → fix common mistakes → bracket balancing. Falls back to safe defaults, never throws.

### 2. Onboarding Answers as JSONB Key-Value
```json
{ "What makes you different?": "We focus on X", "Main objection?": "Price" }
```
AI questions become the keys. No column naming issues. Fully extensible.

### 3. Feedback System (General, not specific)
Outcome is always `positive` or `negative`. User can optionally add a note.
System detects scenario type from the note automatically for Practice Mode pre-loading.
After EVERY negative: Practice Mode suggestion is shown (non-negotiable product behavior).

### 4. Perplexity → Grok Fallback
When user hits daily Perplexity limit:
- Automatically switches to Grok
- Returns `is_fallback: true` and `notice` string
- Frontend shows user-friendly notice
- Grok generates example opportunities based on user profile

### 5. Grok = No Limits
Grok is free. Used for:
- Message generation (as many as user wants)
- AI Coach (unlimited questions)
- Practice mode (unlimited sessions)
- Onboarding questions
- Performance summarization
- Opportunity scoring

### 6. Performance Learning Loop
- Every feedback → increments stats
- Nightly job → when user hits thresholds → Grok analyzes patterns → stores `learned_patterns` text
- That text injected into every future message generation prompt
- This is the compounding data moat

## Environment Setup

```bash
cp .env.example .env
# Fill in values

npm install
npm run dev
```

## Database Setup

Run schema.sql in Supabase SQL editor.
All tables have Row Level Security enabled.
Users can only access their own data.

## Deployment (Railway recommended)

```bash
# Set all environment variables in Railway dashboard
# Deploy from GitHub
# Railway keeps the process running for cron jobs to work
```
