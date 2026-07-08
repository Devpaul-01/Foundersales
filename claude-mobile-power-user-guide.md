# The Complete Claude Power User Guide for Mobile Developers (Free Plan)

---

## ⚠️ HONEST FREE PLAN REALITY CHECK (Read First)

Before anything else — you need to know the real constraints you're working inside.

**Free plan limits (as of May 2026):**

- Roughly **15–40 messages per 5-hour window** with Claude Sonnet. Longer, more complex messages and uploaded files count more toward the limit.
- Limits are **dynamic** — during peak hours (US mornings) you may hit caps sooner.
- Free users are limited to **Claude Sonnet**. Claude Opus (top-tier model) is paid-only.
- **Claude Code agentic capabilities are not available on the free tier.** It's best suited for casual experimentation and testing smaller snippets before adopting a paid plan.

**What this means strategically:** Every message you send is a resource. You cannot afford sloppy, iterative prompting. You need to be surgical. This guide is built around that constraint.

---

## 1. 📱 MOBILE-FIRST WORKFLOWS

### The Core Problem on Mobile

On desktop, developers paste entire files, use keyboard shortcuts, and split-screen between IDE and Claude. On mobile you have: a text box, your clipboard, and your brain. That's actually enough — if you work *with* it, not against it.

### Use Projects (Your Most Important Feature)

Projects let you maintain a persistent context document that's loaded into every conversation automatically. This is the single most powerful tool for a mobile developer on the free plan.

**How to use it:**
1. Create a Project for each major system you're building
2. In the Project instructions, paste your architecture overview, tech stack, key decisions, coding conventions, and file structure
3. Every new chat inside that Project inherits all of that context for free — no re-prompting needed

This solves the biggest mobile problem: you don't have to re-explain your system every time you open a new chat.

### Structure Your Project Instructions Like This

```
SYSTEM: [name]
STACK: Flask, Supabase/Postgres, WebSockets, Vanilla JS, Tailwind
ARCHITECTURE: [3-4 sentence summary of the system]
KEY FILES:
  - app.py → main Flask app, handles routing
  - ws_handler.py → WebSocket logic
  - db.py → Supabase client wrapper

CONVENTIONS:
  - All DB calls go through db.py, never inline
  - Error responses always return {error: str, code: int}
  - No ORM, raw SQL via Supabase RPC

CURRENT FOCUS: [what you're building this week]
```

This document costs zero tokens per new chat — it's always there.

### Mobile Conversation Patterns

**The Single-Task Rule:** Never send a prompt that asks Claude to do more than one logical thing. "Fix this bug AND refactor the auth module AND add tests" burns quota AND produces mediocre results. One clear task per message.

**Paste strategy:** On mobile, always paste code inline with triple backticks and the language tag. Claude reads it better and you don't lose formatting.

**The "briefing message" pattern:** When starting a new chat for a complex task, your first message should be context — not a request:

> *"I'm building a Flask + Supabase real-time notification system. The WebSocket server is in ws_handler.py. The current bug is that clients disconnect silently after 30s with no error surfacing. Here's the relevant code: [paste]"*

Then your second message is the actual request. This primes Claude properly before you spend a message on action.

### Managing Long Projects from Mobile

You don't manage large projects in a single chat. You manage them across a Project with targeted, surgical conversations.

Think of it like Git commits — each chat is a focused unit of work:
- "Design the auth schema"
- "Implement the WebSocket reconnect logic"
- "Audit the Supabase RLS policies"

Not one massive conversation trying to hold the whole system in memory.

---

## 2. 🧩 ADVANCED CAPABILITIES MOST PEOPLE DON'T KNOW

### Claude as a Systems Architect

Most people use Claude reactively: "here's my code, fix it." Elite users use Claude proactively as an architect *before* writing a single line.

**The Architecture Brief Workflow:**

```
You are acting as a senior distributed systems architect.

I need to design [system]. Here are my constraints:
- Scale target: [X]
- Team: [solo/small]
- Stack: [Flask/Supabase/etc]
- Budget: [free tier / low cost]
- Non-negotiables: [real-time, offline-first, etc.]

Before proposing anything, ask me up to 5 clarifying questions
that would most change your architectural recommendations.
```

That last line is critical. It forces Claude to interrogate assumptions rather than jumping to a generic answer.

### The Review → Audit → Implement Pipeline

A three-stage workflow that serious developers use:

**Stage 1 — Review (understanding):**
> *"Read this code. Do NOT suggest changes yet. Tell me what it does, what assumptions it makes, and where the risks are."*

**Stage 2 — Audit (critique):**
> *"Now audit it against these criteria: [security, performance, consistency with my conventions]. List issues by severity."*

**Stage 3 — Implement (fix):**
> *"Now fix the top 3 severity issues. Show full modified functions, not just diffs."*

Never collapse these into one prompt. You get far sharper analysis when Claude isn't trying to simultaneously understand, critique, and fix.

### Multi-Stage Reasoning Prompts

For complex problems, explicitly ask Claude to think in phases:

```
Approach this in three steps:
1. First, restate the problem in your own words to confirm understanding
2. Then, outline 2-3 possible approaches with trade-offs
3. Finally, implement the approach you recommend

Only move to step 3 after you've completed 1 and 2.
```

This dramatically reduces hallucination on complex systems.

### Documentation Generation Pipeline

```
Given this [module/API/schema], generate:
1. A one-paragraph plain English summary (for non-technical stakeholders)
2. A developer-facing README section with: purpose, inputs, outputs, gotchas
3. Inline code comments for the 5 most non-obvious lines
4. One example of correct usage and one example of a common misuse to avoid
```

Do this for each module. Paste results into your Project context. Now Claude always has current documentation to reference.

---

## 3. 🛠 CLAUDE CODE ON MOBILE — HONEST ASSESSMENT

**Claude Code** is the agentic coding tool that runs in your terminal, reads/writes files, runs tests, and browses docs. It is a separate product from claude.ai.

**The hard truth:** Claude Code agentic capabilities require a paid plan AND a terminal — it is not a mobile product. It runs on your machine and calls the API via CLI.

**What you CAN do on mobile (claude.ai chat):**
- Multi-file reasoning if you paste the files
- Full refactoring of modules
- Schema generation and migration scripts
- OpenAPI spec generation
- Architecture design and decision trees
- Debug analysis from logs/stack traces
- Test generation
- Full feature implementation (code-only, you paste into your editor)

**What you CANNOT do on mobile:**
- Autonomous file editing across a project
- Running tests or shell commands
- Iterating on code with live feedback
- Anything requiring actual execution

**Practical Workaround for Mobile:**

Use Claude to generate complete, production-quality code in a single pass, then paste it into your mobile editor (Working Copy for Git, Koder, etc.). The key is writing prompts detailed enough that the first output is close to correct — because iterating is expensive on the free plan.

---

## 4. 🧠 MCP, TOOLS, AND THE SKILLS ECOSYSTEM

### What MCP Actually Is

MCP (Model Context Protocol) is a standard that lets Claude connect to external services — databases, APIs, file systems, GitHub, Notion, etc. — as live tools during a conversation.

**On claude.ai (what you're using):** MCP connectors are available, including Google Drive, Gmail, Google Calendar, and others. These work on mobile.

**For backend dev:** The most relevant connectors are GitHub and any database connectors. You can connect Google Drive and paste in architectural docs stored there — useful for keeping your intelligence documents synced.

**Free plan access:** Available connectors work on the free plan. Tool calls still count toward your message quota.

### Claude "Skills" via Project Instructions

The most powerful version of "skills" for free users is reusable Project instruction sets — saved personas and context. Create project instruction sets like:

- **"Flask API Architect"** — always thinks in terms of your Flask conventions
- **"Security Auditor"** — always checks for injection, RLS gaps, auth issues
- **"Migration Script Generator"** — always outputs idempotent, reversible SQL

These cost nothing and dramatically improve consistency across sessions.

---

## 5. 🔥 ADVANCED PROMPT ENGINEERING

### The Single Most Important Concept

**Claude does not know what you know.** Every hallucination, every off-base response, every generic answer comes from Claude filling in gaps with assumptions. Your job as a prompt engineer is to eliminate gaps.

### Bad Prompt vs. Good Prompt

**❌ Bad:**
```
Help me optimize my database queries
```

**✅ Good:**
```
I have a Flask app using Supabase (Postgres). This query runs on every
WebSocket message and is causing latency:

[SQL query]

Table sizes: messages ~2M rows, users ~50K rows
Current indexes: [list]
Query plan output: [EXPLAIN ANALYZE output]

Identify the bottleneck and suggest the minimal change that would have
the highest impact. Do NOT rewrite the entire schema.
```

The difference: context, constraints, data, and a scoped ask.

### Hallucination Reduction Techniques

**Technique 1 — Ask for confidence:**
> *"For each recommendation, rate your confidence (high/medium/low) and note if you're making an assumption I should verify."*

**Technique 2 — Force grounding:**
> *"Only suggest approaches you have seen work in production Flask + Postgres systems. Do not invent patterns."*

**Technique 3 — Constrain the output:**
> *"Do not suggest any solution that requires adding a new dependency to the project."*

**Technique 4 — Ask for alternatives:**
> *"Give me the solution you recommend, plus one alternative approach and why you're NOT recommending it."*

### Reusable Prompt Templates for Your Stack

**Template: Debugging**
```
Bug: [describe symptom exactly]
Expected: [what should happen]
Actual: [what actually happens]
Reproduction: [steps or code path]
Already tried: [what you've ruled out]
Relevant code: [paste]
Logs/errors: [paste]

Diagnose the root cause. Do not jump to fixes yet.
```

**Template: Feature Implementation**
```
Feature: [name and one-sentence description]
Context: [where it fits in the system]
Inputs: [what data comes in]
Outputs: [what it must produce]
Constraints: [must use X, cannot use Y, must be idempotent, etc.]
Edge cases to handle: [list them]

Implement this as production-quality code matching my conventions:
[paste relevant conventions or a similar existing function]
```

**Template: Architecture Decision**
```
Decision needed: [e.g., "how to handle WebSocket reconnection"]
Scale context: [concurrent users, message volume]
Current approach: [what I'm doing now, why it's insufficient]
Options I've considered: [list them]
My constraints: [free tier infra, solo dev, must use existing stack]

Evaluate each option. Make a recommendation with reasoning.
Flag any hidden costs or failure modes I might have missed.
```

---

## 6. 🏗 LARGE PROJECTS ON THE FREE PLAN

### The Intelligence Document System

Create a set of persistent documents in your Project. This is the backbone of serious project management on mobile.

**Document 1: SYSTEM_OVERVIEW.md**
- What the system does (2-3 paragraphs)
- Architecture diagram in ASCII or described
- Tech stack with versions
- Key architectural decisions and *why* they were made

**Document 2: DATA_MODEL.md**
- Full schema with column descriptions
- RLS policies
- Key relationships
- Non-obvious constraints

**Document 3: API_CONTRACTS.md**
- Every endpoint: method, path, request shape, response shape, auth requirement
- WebSocket event names and payloads

**Document 4: CONVENTIONS.md**
- Naming conventions
- Error handling patterns
- Testing expectations
- File organization rules

These go in your Project context. Every chat starts with Claude having full system knowledge. You never re-explain your system again.

### Incremental Context Feeding

When a chat is getting long and response quality degrades (Claude starts forgetting things or suggesting inconsistent patterns), start a new chat. Don't fight a degrading context — it wastes messages.

At the start of the new chat, paste a "current state summary":

```
CURRENT STATE:
- Implemented: auth, user CRUD, WebSocket broadcast
- In progress: notification delivery queue
- Next: rate limiting on WS connections
- Known issues: reconnect handler not cleaning up dead connections

CURRENT TASK: [specific thing you need now]
```

### OpenAPI Workflow

Generate your OpenAPI spec early, before building endpoints:

```
Given this system description and data model:
[paste SYSTEM_OVERVIEW + DATA_MODEL]

Generate a complete OpenAPI 3.0 spec for the following endpoints:
[list them]

Include: request/response schemas, error responses, auth requirements.
Use camelCase for JSON, snake_case for Postgres.
```

Paste the spec into your Project. Now frontend work, backend work, and testing all reference the same source of truth.

### Using Claude as a Context Compressor

When you have a large codebase section to share but limited tokens:

> *"Read this code and summarize it in a format a senior developer could use to understand it without reading the original. Include: what it does, its dependencies, its assumptions, its edge cases. This summary will replace the actual code in future chats."*

The summary might be 80% as informative at 10% of the token cost.

---

## 7. ⚡ FREE PLAN OPTIMIZATION — THE TACTICAL GUIDE

### Rule 1: Never Iterate When You Can Specify

Every back-and-forth "that's not quite right, try again" exchange costs two messages. Spend 3 extra minutes writing a more complete prompt and save 4 messages. This is the highest-leverage thing you can do.

### Rule 2: Batch Related Questions

**❌ Three messages:**
- "What's the best way to handle WS reconnection?"
- "How should I track connection state?"
- "What about heartbeat intervals?"

**✅ One message:**
```
I'm designing WebSocket reconnection for a Flask app. Answer these three
questions in one response:
1. Best reconnection strategy (exponential backoff vs fixed)?
2. Where to track connection state (server-side dict vs Redis)?
3. Optimal heartbeat interval for mobile clients?

For each: give the recommendation and the one main trade-off.
```

### Rule 3: Use Off-Peak Hours

During peak hours — US mornings — free users hit limits faster. If you're in a different timezone, this is an advantage. Do your heavy-context, multi-message work during US night hours.

### Rule 4: End Every Session with a Summary Request

Before your last message in a session:
> *"Summarize what we've built/decided/implemented today in a format I can paste at the start of tomorrow's chat."*

Paste it into your notes. Next session starts clean with full context, zero wasted messages re-establishing state.

### Rule 5: Know When to Start a New Chat

**Start a new chat when:**
- You're switching to a completely different module
- Response quality has noticeably dropped
- The conversation is over 20-25 exchanges
- You're pivoting from "build" to "audit" mode

**Don't start a new chat when:**
- You're mid-implementation on a feature
- Claude has important context it just established
- You're debugging and Claude has the stack trace loaded

### Rule 6: The Message Budget Mental Model

Think of your ~15–40 messages per 5-hour window as a sprint budget. Allocate before you start:

| Step | Messages |
|------|----------|
| Context/briefing | 1 |
| Main implementation | 2-3 |
| Review/critique | 1 |
| Refinement | 1 |
| **Total** | **~5-6** |

That's a complete feature cycle in 5-6 messages. If you're spending 15 messages on one thing, the prompts need work.

### Free Upgrade Paths Worth Knowing

- **Open Source Program:** Anthropic offers qualifying open source maintainers up to 6 months of Claude Max 20x (the highest tier) completely free. If you're building in public, investigate this at anthropic.com.
- **API Free Credits:** New API users receive a small amount of free credits (~$5) to test the API without payment details. Enough to test integrations before committing.

---

## 8. 🚀 REAL-WORLD WORKFLOWS FOR YOUR STACK

### Building a Flask API from Scratch

| Chat | Purpose | Input | Output |
|------|---------|-------|--------|
| 1 | Architecture | Requirements + constraints | SYSTEM_OVERVIEW + DATA_MODEL |
| 2 | Schema | DATA_MODEL | Migration SQL + indexes + RLS |
| 3 | API Contract | SYSTEM_OVERVIEW + schema | Full OpenAPI 3.0 spec |
| 4+ | Implementation | Intelligence docs + specific task | One module per chat |

### Debugging WebSocket Systems

```
WebSocket bug in Flask + [socketio/raw ws library]:

Symptom: [exact behavior]
Timeline: [when it happens — on connect, after X seconds, under load]
Error in logs: [paste]
Current handler code: [paste]
Connection management code: [paste]

What I've verified:
- [ ] Client is sending heartbeats
- [ ] Server is handling disconnect events
- [ ] Connection dict is being cleaned up

Diagnose only. Do not rewrite code yet.
```

### Adversarial Architecture Review

```
I'm going to describe my system architecture. Your job is to play
"adversarial architect" — find every way it could fail at scale,
every security gap, every operational risk.

Be brutal. I'd rather find problems now than in production.

Here's the system: [paste SYSTEM_OVERVIEW + DATA_MODEL]

Rate each issue: Critical / High / Medium / Low
```

Follow up:
> *"Take the Critical issues only. For each one, give me the minimal change to fix it within my current stack — no new services, no major rewrites."*

### Supabase RLS Audit

```
Audit these Supabase RLS policies for security gaps:

Tables: [list]
Policies: [paste each one]
User roles in my system: [anon, authenticated, service_role, admin]
What each role should be able to do: [describe]

Find any policy that allows more access than intended.
Show me the attack vector for each gap you find.
```

### AI-Integrated System Design

```
I'm building an AI-integrated feature into an existing Flask app.
The feature: [describe]
My constraints: [latency budget, cost ceiling, free-tier infra]
Current stack: [list]

Design the integration layer. Specifically:
1. Where does the AI call sit in the request lifecycle?
2. How do I handle latency without blocking the main thread?
3. What do I cache and where?
4. What's my fallback if the AI call fails?

Do not suggest adding new infrastructure unless unavoidable.
```

---

## 9. ⚠️ COMMON MISTAKES THAT DESTROY OUTPUT QUALITY

| Mistake | Why It Hurts | Fix |
|--------|-------------|-----|
| Vague scope | Claude doesn't know what "better" means to you | Specify: more readable? more secure? fewer deps? |
| No constraints | Claude proposes ideal-world solutions | Always state infra, stack, and cost constraints upfront |
| Too much per message | Claude averages attention across tasks | One logical task per message |
| No existing code | Gets generic answers | Always paste the relevant code |
| Not pushing back | First output is rarely optimal | Ask: "What are the weaknesses of this approach?" |
| Fighting degraded context | Wastes more messages than starting over | Start a new chat with a clean state summary |
| Not using Projects | Burns quota re-establishing context | Use Projects for every active system |
| Accepting hallucinated APIs | Especially bad for newer libraries | Ask Claude to flag any assumption you should verify |

---

## 10. 🧭 YOUR PERSONAL STRATEGY

### One-Time Setup

1. **Create one Project per active system.** Set up all 4 intelligence documents in the Project instructions.
2. **Build a Prompt Library note on your phone.** Your reusable templates pasted and ready to copy. Never rewrite a prompt from scratch.
3. **Identify your off-peak window.** US night hours = more quota, faster responses. Plan heavy work accordingly.

### Daily Workflow

**Morning (planning, low message cost):**
- Architecture decisions, design questions, trade-off analysis
- Single-message questions with high strategic value

**Work sessions (implementation):**
- One chat per feature/module
- Use the Feature Implementation template
- End each session with a state summary

**Periodic review sessions:**
- Run adversarial architecture reviews
- Run RLS/security audits
- Generate/update documentation

### Weekly Rhythm

- **Monday:** Review SYSTEM_OVERVIEW. Update CURRENT_FOCUS. Identify the week's 3 key tasks.
- **Daily:** One chat per task. Use templates. End with summaries.
- **Friday:** Update all intelligence documents to reflect the week's changes.

### When to Upgrade

Don't upgrade preemptively. Use the free plan, see if you hit the limits consistently, and only pay when the friction is genuinely blocking your work. If you're hitting the cap daily and it's slowing real projects, the $20/month Pro plan is worth it. If you're hitting it occasionally, the optimization strategies in this guide will likely solve it.

---

## 📋 Quick Reference Card

```
BEFORE EVERY CHAT:
☐ Am I in the right Project?
☐ Is my Project context current?
☐ Can I batch any related questions?
☐ Have I specified constraints?

PROMPT CHECKLIST:
☐ Context (what system, what module)
☐ The actual code/schema/error
☐ What I want (specific, scoped)
☐ What I don't want (constraints)
☐ What I've already tried

SESSION END:
☐ Ask for a state summary
☐ Paste into notes/Project docs

CHAT HEALTH CHECK:
☐ Is Claude still giving consistent answers?
☐ Am I under 20-25 exchanges?
☐ Has the task scope stayed focused?
→ If any answer is NO: start a new chat with a state summary
```

---

## Final Thought

The gap between basic Claude usage and power usage isn't about secret features. It's about treating every message as a scarce, valuable resource and engineering your prompts to eliminate ambiguity. That mindset shift alone will 3-5x your output quality within a week — before you've changed a single other thing.

Every technique in this guide flows from one principle: **be the senior developer briefing a highly capable contractor who knows nothing about your specific system yet.**

The more complete your briefing, the better the work.
