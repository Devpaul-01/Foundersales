# 🧾 Claude Code Power-User Guide for Mobile Developers
### *How cracked AI-native engineers actually work*

> **Who this is for:** Engineers already using Claude Code daily who feel like they're running on 20% of its capacity. This is not a beginner's guide. There are no prompting basics here. This is the real playbook.

---

## Table of Contents

1. [The Mental Model Shift](#1-the-mental-model-shift)
2. [Advanced Claude Code Workflows](#2-advanced-claude-code-workflows)
3. [Large Codebase Strategies](#3-large-codebase-strategies)
4. [The Claude Configuration Layer (CLAUDE.md, Rules, Settings)](#4-the-claude-configuration-layer)
5. [Skills — Reusable Workflow Macros](#5-skills--reusable-workflow-macros)
6. [Subagents — Parallel Isolated Workers](#6-subagents--parallel-isolated-workers)
7. [Hooks — Deterministic Lifecycle Automation](#7-hooks--deterministic-lifecycle-automation)
8. [Agent Teams — Multi-Agent Orchestration](#8-agent-teams--multi-agent-orchestration)
9. [Git Worktrees — True Parallel Isolation](#9-git-worktrees--true-parallel-isolation)
10. [MCP — Claude Connected to Everything](#10-mcp--claude-connected-to-everything)
11. [Headless Mode & CI/CD Integration](#11-headless-mode--cicd-integration)
12. [Document-Driven Development](#12-document-driven-development)
13. [AI Engineering Systems (as Tech Lead)](#13-ai-engineering-systems-as-tech-lead)
14. [Advanced Prompt Engineering (Not What You Think)](#14-advanced-prompt-engineering-not-what-you-think)
15. [Mobile-First Workflow Optimization](#15-mobile-first-workflow-optimization)
16. [Realistic Limitations & Failure Modes](#16-realistic-limitations--failure-modes)
17. [The Ultimate Mobile AI Engineering Playbook](#17-the-ultimate-mobile-ai-engineering-playbook)

---

## 1. The Mental Model Shift

Most people use Claude Code like a smart autocomplete. Prompt in, code out. That's the least interesting thing it can do.

The correct mental model is **Claude Code as a software engineering platform** — one with a runtime, an event system, a process model, a memory architecture, and a composable tool layer. The engineers getting 10x leverage aren't writing better prompts. They're building systems *around* Claude Code that make it behave like a tireless senior engineer with access to everything.

Here's the shift:

| Beginner mindset | Power-user mindset |
|---|---|
| Ask Claude to write code | Configure Claude to know your codebase permanently |
| Copy output manually | Hook output into test runners, linters, deployment |
| One long chat → context collapse | Subagents with scoped context, worktrees for isolation |
| Paste code for review | Skill that runs a 10-step production review automatically |
| Manual prompting every session | CLAUDE.md loads your system context on every startup |
| One agent at a time | Agent teams running parallel workstreams |
| Claude on your machine | Headless Claude in CI, running 24/7 on Anthropic's infra |

Everything in this guide builds toward that second column.

---

## 2. Advanced Claude Code Workflows

### 2.1 The Audit → Implementation Pipeline

The most powerful pattern for working on large systems is separating **comprehension** from **execution**. Never ask Claude to understand and build simultaneously — context gets diluted.

**Stage 1: Dedicated audit pass**
```
AUDIT ONLY — do not write code yet.

Read [file list]. Produce a structured report covering:
1. Data flow from API entry to DB
2. Authentication/authorization gaps
3. Coupling violations (which modules know too much about each other)
4. Missing error boundaries
5. Anything that would fail a Google-level code review

Output format: numbered findings with severity (P0/P1/P2) and file:line references.
```

**Stage 2: Implementation plan from audit**
```
Using the audit above, produce an implementation plan.
For each P0 and P1 finding, give:
- Exact change required
- Files affected
- Risk of regression
- Test coverage needed

Do NOT write code yet. Order by dependency (what must be done first).
```

**Stage 3: Targeted execution**
Now you execute finding by finding, one scoped session per change. The audit is a living document. The implementation is traceable.

This is how you avoid the most common AI-assisted engineering failure: **Claude fixing the wrong thing confidently**.

---

### 2.2 Architecture → Frontend Generation Pipeline

This is a 4-stage pipeline for generating production-grade frontend from backend architecture.

**Stage 1: Backend contract extraction**
```
Read [controllers/routes]. Extract the complete API contract:
- All endpoints with method, path, params, request body schema, response schema
- Auth requirements per endpoint
- Error states per endpoint
Output as OpenAPI 3.0 YAML.
```

**Stage 2: Frontend architecture document**
```
Given this OpenAPI spec and the tech stack [React/Vue/etc]:
Generate a frontend architecture document covering:
- Component hierarchy (which components own which API calls)
- State management strategy (what lives where, why)
- Loading/error state patterns per endpoint category
- Auth token handling
- Optimistic update opportunities
```

**Stage 3: Component contract generation**
```
For [ComponentName], generate the TypeScript interface, prop types,
and API hook — based on the architecture document above.
No implementation yet. Just the contract.
```

**Stage 4: Implementation**
Now you have scoped, principled implementation work. Each component knows exactly what it needs. No guessing.

---

### 2.3 The Self-Review Loop

Before accepting any significant output, run Claude's output back through Claude in a fresh scope with an adversarial lens:

```
You are a senior engineer at a company with extremely high code quality standards.
The junior engineer below has submitted this code for review.
Be brutal. Find every:
- Logic error
- Off-by-one
- Missing null/undefined check
- Race condition
- Unhandled promise rejection
- N+1 query
- Missing transaction
- Missing index
- Broken edge case
- Security issue (injection, auth bypass, over-exposure)

Code:
[paste output]

Do NOT suggest stylistic improvements. Only correctness and production safety.
```

This two-pass workflow catches a genuinely alarming number of issues that a single-pass generation misses.

---

### 2.4 The WebSocket System Workflow

WebSocket systems are particularly tricky for AI generation because state, reconnection logic, and message ordering all interact non-linearly. Structure the work like this:

1. **Protocol document first** — have Claude generate a message type dictionary, connection lifecycle diagram, and error state machine before writing a single line of code.
2. **Server-side first** — build and test the server event loop in isolation.
3. **Client adapter second** — build the client as an explicit consumer of the protocol document, not the implementation.
4. **Integration test third** — have Claude write integration tests that simulate disconnect/reconnect/message ordering *before* you wire up UI.

If you reverse this order, you'll spend hours debugging emergent behavior that was never specified.

---

### 2.5 Production Debugging Workflow

When you have a live bug:

```
Context:
- System: [brief architecture summary]
- Symptom: [exact error or behavior]
- Reproduction: [steps, or "intermittent under load"]
- Recent changes: [what changed in the last 48h]

Files attached: [list]

Process:
1. List every possible cause of this symptom, ranked by likelihood
2. For the top 3 causes, explain exactly what evidence would confirm or rule out each
3. Point to the specific file:line where you'd look first

Do NOT write a fix yet. I want to understand the cause first.
```

This forces systematic diagnosis rather than Claude pattern-matching to the most common fix and potentially fixing the wrong thing.

---

## 3. Large Codebase Strategies

### 3.1 The System Intelligence Document

This is the single highest-leverage thing you can do for large-project work, and almost nobody does it.

A **System Intelligence Document** (SID) is a hand-crafted, living markdown file that compresses your entire system's architectural knowledge into a form Claude can absorb in a single context load. It is NOT auto-generated. Human-written context files outperform LLM-generated ones significantly — ETH Zürich research (2026) found auto-generated CLAUDE.md reduced task success by ~3% and increased token costs by 20%+, versus ~4% improvement from developer-written files.

**SID structure:**

```markdown
# [Project Name] — System Intelligence Document

## Architecture Overview
[2-3 paragraphs: what this system does, how it's organized, key design decisions]

## Data Model
[Core entities, key relationships, important constraints — not a schema dump]

## Service Map
[Which services exist, what they own, how they communicate]

## Critical Invariants
[Things that MUST always be true — e.g., "user can only see their tenant's data",
"all writes must go through the event bus", "never call external APIs inside transactions"]

## Common Failure Modes
[The bugs that keep happening and why]

## Current State
[What's in progress, what's incomplete, known tech debt]

## File Map (Curated)
[The 20 files Claude needs to understand this system — not every file]
```

This document goes in `CLAUDE.md` or referenced from it. Every session starts with Claude having real system knowledge, not just file content.

---

### 3.2 Context Batching Strategy

Context windows are not infinite budget — they're working memory. Treat them accordingly.

**Do not load:**
- Test files (unless debugging tests)
- Build output
- Lock files
- Migrations (unless doing DB work)
- Vendor/node_modules
- Historical changelogs

**Load in tiers:**

| Tier | What | When |
|---|---|---|
| Always | SID, CLAUDE.md, type definitions | Every session |
| Feature | The 3-5 files directly involved in the task | Per task |
| Reference | Related service interfaces | When crossing service boundaries |
| Debug | Logs, error output, specific suspect files | Debug sessions only |

The engineers who complain about context collapse are almost always loading everything. The engineers getting clean outputs are loading almost nothing and letting their SID carry the comprehension.

---

### 3.3 Document Chaining

For multi-stage work (the audit/implementation pipeline above, or architecture generation), maintain a **session document chain** — each session produces a document that seeds the next:

```
Session 1: Audit → produces audit-report.md
Session 2: Implementation plan → consumes audit-report.md, produces impl-plan.md
Session 3: Component X → consumes impl-plan.md (relevant sections), produces component-x.ts
Session 4: Self-review → consumes component-x.ts, produces review-notes.md
Session 5: Fix → consumes review-notes.md, produces final component-x.ts
```

This chain means no session is carrying the full history. Each session is scoped, efficient, and has exactly what it needs.

---

### 3.4 Memory Preservation Across Sessions

Claude Code has no native long-term memory beyond what you configure. Your persistence layer is:

1. **CLAUDE.md** — project-level permanent context
2. **~/.claude/CLAUDE.md** — global context (your personal preferences, style, tools)
3. **SID** — architectural knowledge
4. **Document chain** — the audit/impl/review documents
5. **Custom subagents** — pre-configured agents with domain knowledge baked in

Treat these as your engineering memory system. Anything you explain to Claude once that you'll need again should be written into one of these files, not left in chat history.

---

## 4. The Claude Configuration Layer

### 4.1 CLAUDE.md — Your Permanent System Prompt

CLAUDE.md is loaded at session start. It is your opportunity to make Claude permanently aware of everything important before you type a single word. Most people leave this blank or put three lines in it. That's a waste.

**Project-level CLAUDE.md** (in repo root):

```markdown
# Project: [Name]

## What this is
[1 paragraph — what the system does, who uses it, why it matters]

## Architecture rules
- Multi-tenant: EVERY query must filter by tenantId. No exceptions.
- All writes must be wrapped in database transactions.
- Business logic lives in /services, never in /controllers.
- Don't call external APIs inside event handlers. Queue them.

## Tech stack
- Backend: Node.js + Express + PostgreSQL (Sequelize)
- Frontend: React + TypeScript + Zustand
- Queue: BullMQ + Redis
- Auth: JWT with refresh token rotation

## Key files
- /src/services/auth.service.ts — auth logic
- /src/middleware/tenant.middleware.ts — tenant injection
- /src/workers/notification.worker.ts — background job processing

## DO NOT
- Use raw SQL (use Sequelize)
- Put business logic in route handlers
- Generate seed data with production credentials
- Commit .env files
```

**Global CLAUDE.md** (`~/.claude/CLAUDE.md`):

```markdown
# My Engineering Standards

## Code style
- TypeScript strict mode always
- Prefer explicit error handling over try/catch swallowing
- Every async function should have documented failure modes

## My preferences
- When I say "generate", write complete working code
- When I say "review", be adversarial — find problems
- When I say "audit", produce structured findings with severity ratings
- Never say "I've updated the code" and then show snippets — show the full file

## Context about me
- I work across: Node.js backend, React frontend, Flask/Python services
- I have production systems — treat everything as production-grade by default
- I'm building toward Google-level engineering standards
```

---

### 4.2 Rules Files — Scoped Behavior

Rules files let you apply specific behaviors to specific paths without bloating your main CLAUDE.md:

```
.claude/
├── CLAUDE.md              # global project context
└── rules/
    ├── backend.md         # applied when working in /src/
    ├── frontend.md        # applied when working in /client/
    ├── tests.md           # applied when editing *.test.ts files
    └── migrations.md      # applied when touching /migrations/
```

**Example** `.claude/rules/backend.md`:
```markdown
## Backend Rules
- Every new endpoint must have input validation middleware
- Database calls belong in repository classes, not services
- All repository methods must accept a transaction parameter
- Return types must be explicit — no `any`
```

---

### 4.3 Settings.json — Capability Configuration

`~/.claude/settings.json` controls Claude Code's runtime behavior:

```json
{
  "permissions": {
    "allow": ["bash", "read", "write"],
    "deny": ["bash(rm -rf *)", "bash(git push --force)"]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{"type": "command", "command": "cd $CWD && npm test -- --bail 2>&1 | tail -20"}]
      }
    ]
  },
  "env": {
    "CLAUDE_CONTEXT_FILES": "CLAUDE.md,src/types/index.ts"
  }
}
```

---

## 5. Skills — Reusable Workflow Macros

Skills are the feature most people haven't heard of that would immediately change how they work.

**What a skill is:** A markdown file that defines a complete, reusable workflow. You invoke it with a slash command. Claude follows the steps inside. Consistent, token-efficient, and scoped.

**The problem they solve:** You write the same 300-word "do a production review" prompt every time you want a code review. Skills kill that duplication permanently.

### 5.1 Creating a Skill

```
.claude/skills/production-review/SKILL.md
```

```markdown
---
name: production-review
description: Production-grade code review. Invoke for any code before merging.
---

Perform a production-grade code review on the provided files.

## Step 1: Security Pass
Check for:
- Hardcoded credentials or secrets
- Missing input validation
- SQL injection vectors
- Broken authentication/authorization logic
- Over-exposed data in API responses

## Step 2: Correctness Pass
Check for:
- Logic errors
- Off-by-one errors
- Null/undefined not handled
- Race conditions
- Missing transaction boundaries
- Unhandled promise rejections

## Step 3: Performance Pass
Check for:
- N+1 query patterns
- Missing database indexes for query patterns
- Unnecessary re-renders (frontend)
- Memory leaks

## Step 4: Report
Output a structured report:
- CRITICAL (blocks merge)
- WARNING (should fix soon)
- INFO (consider improving)

Format: finding | file:line | explanation | suggested fix
```

**Invoke it:** `/production-review` — that's it. Every session. Every codebase. Consistent.

---

### 5.2 High-Value Skills to Build

| Skill | What it does |
|---|---|
| `/production-review` | Full review with security, correctness, performance |
| `/audit-endpoint` | Reviews a single API endpoint for all failure modes |
| `/generate-tests` | Produces test suite for a file using your test patterns |
| `/new-feature` | Walks through architecture → interface → implementation |
| `/refactor` | Structured refactor with defined constraints |
| `/debug-session` | Systematic diagnosis workflow |
| `/api-spec` | Generates OpenAPI spec from controller files |
| `/migration-check` | Reviews DB migrations for safety and rollback |
| `/doc-generate` | Generates JSDoc/docstrings + README sections |

---

### 5.3 Auto-Invocation

Skills can be configured to auto-activate when Claude detects relevant context — no slash command needed. Set `disable-model-invocation: false` in the frontmatter and add a clear description:

```markdown
---
name: migration-check
description: Safety review for database migrations. Auto-invoke when editing files in /migrations/.
disable-model-invocation: false
---
```

Now whenever you edit a migration file, Claude automatically runs the migration safety check.

---

## 6. Subagents — Parallel Isolated Workers

Subagents are the feature that turns Claude Code from a chatbot into a software engineering system. They spin up separate AI instances with their own context windows, tool permissions, and system prompts.

**The critical concept most people miss:** Subagent files (`.claude/agents/*.md`) are **system prompts**, not user prompts. You are configuring a specialized agent, not writing instructions for a task.

### 6.1 Why Subagents Matter

Your main session's context fills up. When it does, Claude starts losing earlier context — the critical architecture decisions, the error you showed earlier, the constraint you specified. Subagents solve this by isolating work into clean context windows.

Additionally: parallel execution. Your main session can dispatch multiple subagents concurrently, each grinding on a different piece of work.

---

### 6.2 Creating Subagents

```
~/.claude/agents/security-reviewer.md   # personal (available in all projects)
.claude/agents/api-reviewer.md          # project-specific
```

**Example:** `.claude/agents/security-reviewer.md`

```markdown
---
name: security-reviewer
description: Security-focused code analysis. Invoke for authentication, authorization, and data handling code.
context: fork
tools: [read, bash]
isolation: worktree
---

You are a security engineer with 15 years of experience finding critical vulnerabilities.

When invoked with code or file paths:

1. Check for hardcoded secrets, API keys, credentials
2. Verify all user input is validated and sanitized before use
3. Check authorization: does every protected resource verify the caller has access?
4. Check for injection vulnerabilities (SQL, command, template)
5. Verify sensitive data is not exposed in logs, errors, or API responses
6. Check for insecure direct object references

Output:
- CRITICAL: [finding] at [file:line] — [explanation]
- HIGH: [finding] at [file:line] — [explanation]
- Verdict: APPROVE / BLOCK with justification
```

**Example invocations:**
- "Have the security-reviewer look at src/middleware/auth.ts"
- "Run a security review on the new payment endpoints"

---

### 6.3 Subagent Patterns

**Pattern 1: Parallel exploration**
```
Dispatch 3 subagents simultaneously:
- Explorer 1: Map all database access patterns in /src/services
- Explorer 2: Map all external API calls and their error handling
- Explorer 3: Map all authentication/authorization checkpoints

Each returns a structured summary. Main session synthesizes.
```

**Pattern 2: Specialist reviewer**
Security reviewer, performance reviewer, test generator — each a subagent invoked for its domain.

**Pattern 3: Deep-dive isolator**
When a specific file or module needs deep analysis that would pollute your main session's context, dispatch a subagent for the single-file deep dive and get back only the findings.

---

### 6.4 Common Subagents to Build

| Subagent | Role |
|---|---|
| `code-reviewer` | General code review specialist |
| `security-reviewer` | Security-focused analysis |
| `test-generator` | Produces tests for a given module |
| `doc-writer` | Generates documentation from code |
| `db-reviewer` | Reviews database queries and schema decisions |
| `api-explorer` | Maps and documents API contracts |
| `perf-analyzer` | Identifies performance bottlenecks |
| `debug-agent` | Systematic diagnosis specialist |

---

## 7. Hooks — Deterministic Lifecycle Automation

Hooks are shell scripts that fire in response to Claude Code events. They are the only truly deterministic part of Claude Code — they don't rely on Claude deciding to do something. They always fire.

### 7.1 Hook Events

**Blocking events (can stop or modify what happens):**
- `UserPromptSubmit` — fires when you submit a prompt; can block or modify before Claude sees it
- `PreToolUse` — fires before any tool runs; primary security checkpoint
- `PermissionRequest` — fires when Claude asks for permission; can auto-approve or deny

**Informational events (cannot block, but can log/notify):**
- `PostToolUse` — fires after tool completes
- `PostToolUseFailure` — fires after tool failure
- `SessionStart` / `SessionEnd` — lifecycle events
- `Stop` / `SubagentStop` — agent completion events
- `PreCompact` — fires before context compaction

---

### 7.2 The Most Valuable Hooks

**Auto-run tests after file edits** (this one alone changes how you work):
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "cd $CWD && npm test -- --bail 2>&1 | tail -20"
      }]
    }]
  }
}
```
Claude edits a file → tests run automatically → Claude sees if it broke anything → fixes without you asking. It stops being reactive and starts being anticipatory.

**Block dangerous commands:**
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "bash",
      "hooks": [{
        "type": "command",
        "command": "COMMAND=$(jq -r '.tool_input.command'); if echo \"$COMMAND\" | grep -q 'rm -rf'; then jq -n '{hookSpecificOutput: {hookEventName: \"PreToolUse\", permissionDecision: \"deny\", permissionDecisionReason: \"Destructive command blocked\"}}'; fi"
      }]
    }]
  }
}
```

**Notify when task completes** (critical for mobile — you can walk away):
```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "osascript -e 'display notification \"Claude finished\" with title \"Claude Code\"'"
      }]
    }]
  }
}
```

**Auto-lint after edits:**
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit",
      "hooks": [{
        "type": "command",
        "command": "cd $CWD && npx eslint $TOOL_OUTPUT_FILE 2>&1 | tail -10"
      }]
    }]
  }
}
```

**Backup before context compaction:**
```json
{
  "hooks": {
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "cp ~/.claude/transcript.json ~/.claude/transcripts/$(date +%Y%m%d-%H%M%S).json"
      }]
    }]
  }
}
```

---

### 7.3 Hook Design Principles

- Hooks should be **fast** — if they take more than 5s, they disrupt flow
- Use hooks for **verification**, not for generating content
- Hook output gets injected back as context — keep it short and parseable
- Use `PreToolUse` as your security layer — it's the last line of defense
- Use `Stop` hooks for notifications on long-running tasks (especially valuable on mobile)

---

## 8. Agent Teams — Multi-Agent Orchestration

Agent Teams (released February 2026) are the most powerful Claude Code feature for complex engineering work. A Team Lead spawns Teammates — independent Claude Code instances, each with 1M token context windows, that can communicate via a mailbox system.

### 8.1 How Agent Teams Work

```
You (orchestrator)
    └── Team Lead (your main Claude session)
            ├── Teammate 1 — Security analysis
            ├── Teammate 2 — Performance review
            └── Teammate 3 — Test generation

Teammates communicate: "Found auth issue in line 45"
Team Lead synthesizes → presents unified result to you
```

This is the closest existing thing to "multiple engineers on the same feature simultaneously."

### 8.2 Enabling Agent Teams

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
claude
```

Then instruct your Team Lead to delegate:
```
Split this work across your team:
- Have one teammate audit the authentication layer
- Have another audit the data access layer  
- Have a third generate the test suite
Synthesize the findings into a single structured report.
```

### 8.3 When to Use Agent Teams vs Subagents

| Use subagents when | Use agent teams when |
|---|---|
| Tasks are independent | Teammates need to communicate findings to each other |
| Context isolation is the goal | You want parallel workstreams that feed into synthesis |
| Spawning specialized reviewers | Building out a full feature across multiple domains simultaneously |
| Single-domain deep dive | Complex multi-domain work (auth + data + tests + docs) |

**Context limitation to understand:** Agents don't share their full context windows — they communicate via explicit messages only. Design with this in mind.

---

## 9. Git Worktrees — True Parallel Isolation

Worktrees are now natively supported in Claude Code (v2.1.x+). They solve the fundamental problem of parallel agents sharing a filesystem.

**Without worktrees:** Two subagents writing to the same files → collisions → chaos.

**With worktrees:** Each agent gets its own checkout with its own branch. They write freely. You merge when done.

### 9.1 How to Use Worktrees

**In conversation:**
```
Work in a worktree for this task.
```
Claude invokes `EnterWorktree` automatically.

**In subagent frontmatter:**
```markdown
---
name: feature-builder
isolation: worktree
---
```
Every dispatch of this subagent automatically gets an isolated worktree.

### 9.2 Parallel Worktree Pattern

```
Dispatch 3 isolated subagents simultaneously:
- Subagent A (worktree: feature/auth-refactor): Refactor auth module
- Subagent B (worktree: feature/add-tests): Add test coverage
- Subagent C (worktree: feature/migration-fix): Fix broken migration

Each works independently. No file conflicts. You merge when done.
```

Teams are running 4–8 concurrent worktrees per developer reliably as of mid-2026.

### 9.3 Worktree Gotchas

- Branch name collisions across agents — use unique naming conventions
- `cd` doesn't persist inside a subagent's bash calls — use `isolation: worktree` instead
- Untracked files can block cleanup — structure output carefully
- Test worktree-aware scripts in a clean clone before CI use

---

## 10. MCP — Claude Connected to Everything

MCP (Model Context Protocol) is an open protocol for connecting Claude to external tools, APIs, and data sources. Without MCP, Claude is isolated. With MCP, it becomes an active participant in your development environment.

### 10.1 What MCP Actually Enables

```
"Implement the feature described in Linear issue ENG-4521 and open a PR"

Claude:
1. Reads the Linear ticket via Linear MCP server
2. Writes the code
3. Opens the PR via GitHub MCP server
4. Posts a summary to Slack via Slack MCP server
```

That is not hypothetical. That is a working workflow today.

### 10.2 High-Value MCP Servers for Engineers

| Server | What it unlocks |
|---|---|
| **GitHub MCP** | Read issues/PRs, create branches, open PRs, review diffs |
| **Linear/Jira MCP** | Read tickets, update status, link code to issues |
| **Postgres/SQLite MCP** | Direct DB queries — Claude can explore schema live |
| **Filesystem MCP** | Controlled file access outside the project directory |
| **Slack MCP** | Post summaries, check threads, send notifications |
| **Notion/Confluence MCP** | Read/write documentation and specs |
| **Figma MCP** | Read design specs and generate components from them |
| **Sentry MCP** | Read error reports and traces — context for debugging |

### 10.3 Configuring MCP

In `.claude/.mcp.json` (project-level):
```json
{
  "mcpServers": {
    "github": {
      "type": "url",
      "url": "https://api.githubcopilot.com/mcp/v1",
      "headers": {"Authorization": "Bearer $GITHUB_TOKEN"}
    },
    "postgres": {
      "type": "stdio",
      "command": "mcp-server-postgres",
      "args": ["postgresql://localhost/mydb"]
    }
  }
}
```

Verify connections: `claude mcp list` or `/mcp` inside a session.

### 10.4 MCP on Mobile

The honest assessment: **MCP servers are configured on the machine running Claude Code**, not on your phone. If you're using Claude Code's mobile interface (not the terminal), you're not running arbitrary MCP servers locally.

However:
- **Claude.ai's web interface** supports MCP connectors for services like Google Drive, Gmail, Calendar — these work on mobile
- **Remote Claude Code instances** (via SSH or cloud dev environments) can have MCP configured server-side — you access them from mobile but the MCP servers run remotely
- **Headless Claude Code in CI** runs with full MCP configuration regardless of where you're monitoring from

The pattern for mobile power users: set up a cloud dev environment (Gitpod, CodeSandbox, Railway dev box, or a DigitalOcean droplet with your full config) and SSH into it from mobile when you need full MCP power.

---

## 11. Headless Mode & CI/CD Integration

Claude Code's headless mode (`-p` flag) is the feature that turns it into a 24/7 engineering system. It runs non-interactively — one prompt, stdout output, exit. Chain it. Pipe it. Script it.

### 11.1 Headless Basics

```bash
# Basic headless
claude -p "Summarize the main architectural decisions in this repo"

# Pipe input
git diff HEAD~1 | claude -p "Write a Slack update summarizing these changes"

# Chain Claude with Claude
claude -p "What are the main risks in the current auth implementation?" \
  | claude -p "For each risk, write a specific test case that would catch it"

# Output to file
claude -p "Generate an OpenAPI spec for the routes in src/routes/" > api-spec.yaml
```

### 11.2 GitHub Actions Integration

```yaml
# .github/workflows/claude-review.yml
name: Claude Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            Review this PR for:
            1. Security issues
            2. Logic errors
            3. Missing error handling
            4. Performance concerns
            
            Post findings as PR review comments. Block if any CRITICAL issues.
```

Now Claude reviews every PR automatically. You review Claude's findings.

### 11.3 Scheduled Tasks

Claude Code supports scheduled execution:
- **Cloud Scheduled Tasks:** Run on Anthropic's infrastructure (hourly minimum) — works when your machine is off
- **Desktop Scheduled Tasks:** Run locally (1-minute minimum)

```bash
# Create a scheduled task — runs daily at 9am
claude schedule create "0 9 * * *" "Run the production health check audit on src/"
```

This is how you get Claude doing engineering work while you sleep.

### 11.4 The Headless Pipelines That Matter

```bash
# Daily tech debt tracker
find src -name "*.ts" | xargs claude -p "Identify tech debt in these files, output JSON" >> tech-debt.jsonl

# Auto-generate changelog from git history
git log --oneline --since="1 week ago" | claude -p "Write a user-facing changelog from these commits"

# Pre-deploy audit
claude -p "Audit src/ for any production-safety issues. Exit code 1 if CRITICAL found." || exit 1

# Architecture drift detection
claude -p "Compare the current codebase against the architecture in CLAUDE.md. Report any drift."
```

---

## 12. Document-Driven Development

The most reliable way to work with Claude on complex systems is to drive everything through documents. Documents persist across sessions. Documents compress knowledge. Documents create a paper trail.

### 12.1 The Core Documents

**Architecture Decision Record (ADR):**
```markdown
# ADR-001: Multi-tenant data isolation strategy

## Status: Accepted
## Context: We need to ensure tenant data never leaks across tenant boundaries.
## Decision: Row-level tenantId filtering on every query via middleware injection.
## Consequences: 
- Pro: Simple, auditable
- Con: Relies on developers not bypassing middleware
- Mitigation: Subagent lint rule checks every query for tenantId
```

Have Claude generate your first set of ADRs from existing code, then maintain them as living documents.

**OpenAPI Spec:**
Generate from controllers, keep in sync, use as the frontend's source of truth. Any time the API changes, the spec updates. The frontend generates TypeScript types from the spec.

**System Intelligence Document:** (see Section 3.1)

**Audit Documents:**
Each audit produces a structured document. These chain into implementation plans, which chain into implementation sessions.

**Frontend Architecture Document:**
Component hierarchy, state management decisions, data fetching strategy — one document, not scattered in Slack.

---

### 12.2 The Document Chain Workflow

```
Week 1: Architecture
  [SID] ← you write this once
  [ADRs] ← generated from existing code, then maintained
  [OpenAPI] ← generated from routes, kept updated

Week 2: New Feature
  [Feature spec] ← you write requirements
  [Technical design] ← Claude generates from spec + SID
  [Implementation plan] ← Claude generates from technical design
  
Week 3: Implementation
  [Implementation] ← Claude executes implementation plan, file by file
  [Test spec] ← Claude generates from implementation
  [Review findings] ← Claude reviews its own output adversarially
  
Week 4: Refinement
  [Fix list] ← from review findings
  [Updated implementation] ← targeted fixes
  [Updated SID] ← architecture decisions recorded
```

This is how you run a real engineering organization solo, from a phone.

---

### 12.3 Avoiding Context Overload

When feeding documents to Claude:
- **Summarize before loading:** A 50-page architecture doc should be summarized to the 2 pages that matter for the current task
- **Reference, don't embed:** "The auth design is in ADR-003 — here's the relevant section:" rather than pasting the whole ADR
- **Use tiered loading:** Load summaries by default, full docs only when specifically needed
- **Kill old context aggressively:** Start a new session rather than continuing a bloated one

---

## 13. AI Engineering Systems (as Tech Lead)

Here is how elite AI-assisted engineers structure Claude's roles across a project.

### 13.1 Claude as Architect

**Role:** Design systems, evaluate tradeoffs, produce decision documents.

**How to invoke this correctly:**
```
Acting as a staff-level architect, evaluate three approaches to implementing 
real-time notifications in this system:
1. WebSockets
2. Server-Sent Events  
3. Long polling

For each approach:
- Technical fit with current architecture
- Operational complexity
- Scalability ceiling
- Implementation effort

End with a recommendation and the 3 most important risks of that recommendation.
```

The key: **ask for evaluation and tradeoffs**, not for code. Architects design; they don't immediately implement.

---

### 13.2 Claude as Reviewer

Dedicated review sessions, never tacked onto generation sessions. Use a fresh context. Use the adversarial prompt from Section 2.3. Be explicit about review depth:

```
Standard review: correctness and obvious issues
Production review: correctness + security + performance + edge cases
Adversarial review: act like someone trying to break this system
Architecture review: evaluate design decisions, not implementation details
```

---

### 13.3 Claude as Debugger

Diagnosis before fix. Always. The pattern:
1. Describe symptom precisely
2. Ask for hypothesis list (ranked by likelihood)
3. Ask for evidence needed to confirm/rule out top hypotheses
4. Execute the diagnosis
5. Only then: ask for the fix

---

### 13.4 Claude as QA System

```
You are a QA engineer who has seen every class of production bug.
Given this feature implementation:
1. Write the test plan (not the tests yet) — cover happy path, edge cases, failure modes
2. Identify the 3 test cases most likely to catch real bugs
3. Write those 3 test cases in full
4. Identify what this test suite would NOT catch (its blind spots)
```

The last question is the most important. Knowing what your tests miss is as valuable as what they cover.

---

### 13.5 Claude as Documentation Generator

```
Generate documentation for [file/module]:
1. JSDoc comments for every exported function (focus on WHY, not WHAT)
2. README section explaining the module's role in the system
3. Usage examples for the 3 most common use cases
4. Gotchas and failure modes section

Style: precise, technical, no marketing language.
```

---

### 13.6 Claude as Product Strategist

For startup-adjacent work (like Kith):
```
Given this feature [description]:
1. What is the core user value proposition?
2. What is the minimum implementation that delivers that value?
3. What are the 3 most common reasons users would not use this feature?
4. What does success look like 90 days after shipping?
5. What's the first thing you'd cut if you had 50% of the time?
```

This is Claude as a PM forcing function — it makes you articulate what you actually want before you build it.

---

## 14. Advanced Prompt Engineering (Not What You Think)

This section is about why sophisticated prompts fail and how to fix them. Not "be more specific."

### 14.1 Why Context Gets Ignored

When you load 10 files and ask Claude to "fix the bug," it doesn't read all 10 files with equal attention. It reads the most recent parts of context most carefully. This is the dirty secret of context windows.

**Fixes:**
- Put the most important constraint at the END of your prompt, not the beginning
- Restate critical constraints inline with the task: "Fix the bug in auth.ts — remember the multi-tenant rule: every query MUST filter by tenantId"
- Use structure: numbered requirements are read more carefully than paragraphs
- Reference specific files rather than loading everything

---

### 14.2 The Holistic Analysis Forcing Pattern

Claude defaults to analyzing whatever you show it. Force system-level thinking:

```
Before touching any code, explain how this change will affect:
1. The other 3 services that call this function
2. The authentication flow
3. The caching layer
4. Any background jobs

Only after that explanation, make the change.
```

This prevents the pattern where Claude makes a technically correct local change that breaks something elsewhere.

---

### 14.3 Reducing Hallucinations in Large Systems

Hallucinations in code mostly occur when Claude fills gaps with plausible-looking code. Eliminate the gaps:

```
You may only use functions and methods that exist in the codebase I've shown you.
If you need a function that doesn't exist yet, say "I need to create X" 
rather than inventing it inline.
If you are uncertain about an API, ask rather than assuming.
```

This instruction alone dramatically reduces hallucinated API calls.

---

### 14.4 Production-Level Thinking Enforcement

The phrase "production-grade" is not specific enough. Be explicit:

```
This code will handle 10,000 concurrent users.
It processes financial data — accuracy is non-negotiable.
It will be run by developers who didn't write it.
It must still work correctly at 3am when it fails and someone is oncall.

Given all of that:
```

Anthropomorphizing the stakes makes Claude's output substantively more careful.

---

### 14.5 The Constraint Stack

For complex generation, give Claude a constraint stack — ordered priorities it must satisfy:

```
Constraints (in priority order — if they conflict, favor higher):
1. Correctness: it must work
2. Security: it must not expose vulnerabilities  
3. Maintainability: the next developer must understand it
4. Performance: optimize only when correctness and security are satisfied
5. Brevity: shorter is better, but not at the cost of 1-4

Generate [thing] with these constraints.
```

This eliminates the ambiguity about what Claude should prioritize when making tradeoffs.

---

### 14.6 The Self-Consistency Check

For critical decisions:
```
You just recommended [approach]. 
Now argue the opposite — why is this a bad idea?
After arguing both sides, give your final recommendation.
```

This surfaces tradeoffs Claude would otherwise hide in a confident single-answer response.

---

## 15. Mobile-First Workflow Optimization

This section is for engineers working primarily from a phone. The constraints are real: small screen, no persistent terminal, copy/paste friction, limited multitasking. But the workflows are still genuinely powerful.

### 15.1 The Mobile Claude Code Stack

**Core setup:**
- **Claude.ai mobile app** — primary interface for most sessions
- **Working Copy** (iOS) / **Acode** (Android) — mobile git + file editor
- **SSH client** (Termius, Blink Shell) — access to a cloud dev box with full Claude Code CLI
- **Cloud dev environment** (Gitpod, Codeflow, Railway dev box, or DigitalOcean) — where real terminal Claude Code runs
- **Clipboard manager** — essential for managing code snippets on mobile (Copied, Pasty)

**The core mobile pattern:**
- Use Claude.ai mobile for planning, architecture, audit, review, document generation
- SSH into cloud dev box for terminal Claude Code when you need hooks, subagents, MCP, headless mode
- Sync code changes via Working Copy / git

---

### 15.2 Prompt Organization on Mobile

**Don't type long prompts from scratch every session.** Maintain a prompt library:

- **Apple Notes / Notion** — organized prompt templates by workflow type
- **Keyboard shortcuts** — iOS text replacement for your most-used prompts
  - `;;review` → expands to your full production review prompt
  - `;;audit` → expands to your full audit prompt
  - `;;debug` → expands to your debug session starter
- **Share sheet integration** — on iOS, you can share code snippets directly into Claude via the share sheet

**Prompt library structure:**
```
📁 Claude Prompts
  📁 Audit
    - Production review
    - Security review
    - DB schema review
  📁 Architecture
    - System design request
    - ADR generation
    - API contract extraction
  📁 Debug
    - Bug diagnosis
    - Production incident
  📁 Generation
    - New endpoint
    - New component
    - Test suite
```

---

### 15.3 Session Management on Mobile

**The biggest mobile mistake:** Starting a new session every time without seeding context. Every session should start with:

```
Context reset — here's what you need to know:
[paste 3-5 key lines from your SID]
Current task: [specific task]
```

Two sentences of context saves 20 messages of back-and-forth.

**Long session strategy:**
- When a session gets long on mobile, create a summary prompt: "Summarize the key decisions and code written in this session in 10 bullet points." Save that summary to Notes.
- Start new session with that summary as the seed.

**Multi-session document chain:**
Keep a running document in Notes/Notion for the current feature. Each session produces output that goes into the document. The document goes into the next session. You never lose context even across sessions.

---

### 15.4 Chunking Strategy for Mobile

On mobile, you can't easily paste 500 lines of code. Work around this:

**Chunked file feeding:**
```
Session 1: "Here is Part 1 of 3 of the auth service. Acknowledge and wait."
[paste chunk 1]

Session 1: "Here is Part 2 of 3."
[paste chunk 2]

Session 1: "Here is Part 3 of 3. Now: [your actual question]"
[paste chunk 3]
```

**File reference instead of paste:**
When working via SSH into a cloud box, you never paste code — Claude Code reads the files directly. This is the real advantage of the cloud dev environment + SSH workflow for mobile.

**Output chunking:**
For long output, ask for it in sections:
```
Generate the auth service. Start with just the types and interfaces.
When I say "continue", give me the constructor and initialization.
When I say "continue" again, give me the public methods.
```
This fits mobile scroll behavior and copy/paste workflow.

---

### 15.5 Clipboard Management

Your clipboard is your working memory on mobile. Discipline:

- **One snippet at a time** — don't try to juggle multiple code blocks
- **Copy outputs to Notes immediately** — don't trust them to stay in chat
- **Clipboard manager apps** (Copied on iOS, Clipper on Android) — gives you a clipboard history so you can recover earlier snippets
- **Use markdown** — code blocks in Claude's output are easier to select/copy than raw text

---

### 15.6 Mobile-Specific Optimizations

**Use voice for long prompts:** iOS/Android voice input is surprisingly good for technical prose. Dictate your architecture question, clean it up in the text field.

**Use Projects:** Claude.ai's Projects feature saves context between sessions. Your CLAUDE.md equivalent lives in the project instructions. You don't re-seed context every time.

**Screenshot + analyze:** On mobile, screenshot your code editor, share to Claude, and ask Claude to review what it sees. Faster than copy/paste for quick questions.

**Deep Research for architecture decisions:** Claude.ai's Deep Research feature on mobile is genuinely useful for evaluating library choices, architectural patterns, and technology comparisons before you build.

**Asynchronous workflow:** The best mobile engineering workflow is asynchronous. Dispatch Claude on a task, go do something else, come back to review. The Stop hook notification (configured on your cloud box) tells you when it's done.

---

## 16. Realistic Limitations & Failure Modes

This section is the most important one if you want to avoid real production problems. No tool is universally praised here.

### 16.1 What Claude Is Actually Bad At

**Maintaining correctness across large diffs:**
When Claude makes more than ~200 lines of changes in a single session, the probability of subtle bugs increases significantly. Scope matters. Smaller, targeted changes are more reliable than big rewrites.

**System-level reasoning without being told:**
Claude does not intuitively model the distributed system. It will optimize a function perfectly and break the service that calls it. You must explicitly ask it to reason about callers, dependencies, and downstream effects.

**Database migrations:**
This is a high-risk area. Claude will write syntactically correct migrations that are logically dangerous (locking tables in production, missing rollback paths, incorrect index strategies). Every migration needs human review regardless of how good the prompt was.

**Concurrency and race conditions:**
Claude can identify known patterns (double-spend, lost update) when asked, but does not naturally reason about concurrent execution paths in complex systems. Ask explicitly. Test explicitly.

**Long-term architectural consistency:**
Over multiple sessions, Claude's suggestions can drift from the architectural decisions in your ADRs. It doesn't remember them unless you load them. This is why the SID exists, and why you must audit for architectural drift periodically.

**Performance at scale:**
Claude can write code that works correctly at small scale and fails at large scale. It doesn't naturally think about the 10,000-concurrent-user case unless you tell it to. Always specify scale constraints.

---

### 16.2 Where Bugs Commonly Appear

In approximate order of frequency in AI-assisted codebases:

1. **Missing error boundaries** — async functions without catch blocks
2. **Missing null/undefined checks** — especially on API response fields
3. **Missing transaction boundaries** — multiple related writes that aren't atomic
4. **N+1 query patterns** — especially in loops over collections
5. **Missing authorization checks** — endpoint that authenticates but doesn't check resource ownership
6. **Over-exposed fields** — API responses returning more data than needed
7. **Race conditions** — especially in background workers and event handlers
8. **Missing input validation** — endpoints that trust client-provided data

Run your `/production-review` skill against every significant output. These are the patterns it should be catching.

---

### 16.3 The Over-Dependence Trap

The engineers who get into the most trouble are the ones who stop reading the generated code carefully. Here's the failure mode:

1. Claude generates code
2. It looks right
3. You ship it
4. A week later there's a production incident
5. You read the code for the first time and see the obvious bug

**The discipline:** You must be able to explain every line of significant AI-generated code to another engineer. If you can't, you haven't finished the task — you've just created a liability.

This doesn't mean you have to write everything yourself. It means you have to genuinely understand what was written. AI-generated code you don't understand is technical debt you don't even know you have.

---

### 16.4 Architecture Document Danger

Architecture documents generated by Claude based on your description can be seductively comprehensive — and wrong. The document can reflect what you meant to build, not what you actually built. This creates a false sense of system understanding.

**Rule:** Architecture documents must be validated against actual code, not just against your descriptions. Have Claude read the actual files and report discrepancies between the document and reality.

---

### 16.5 Context Drift

In long sessions, Claude gradually loses precision about things stated early in the conversation. By the 50th message, the constraint you stated in message 3 may be effectively forgotten.

**Signals of context drift:**
- Claude starts suggesting approaches you already ruled out
- Code stops following your established patterns
- Error handling becomes inconsistent with earlier code

**Fix:** Start a new session. Explicitly restate the key constraints from your SID. Context drift is not a bug — it's physics. Manage around it.

---

## 17. The Ultimate Mobile AI Engineering Playbook

This is the synthesis. How a cracked AI-native engineer operates solo from mobile, building production systems.

### 17.1 One-Time Setup (Do This First)

**Repository configuration:**
```
repo/
├── CLAUDE.md                     # System Intelligence Document
├── .claude/
│   ├── settings.json             # Hooks, permissions
│   ├── rules/
│   │   ├── backend.md
│   │   └── frontend.md
│   ├── agents/
│   │   ├── security-reviewer.md
│   │   ├── db-reviewer.md
│   │   └── test-generator.md
│   ├── skills/
│   │   ├── production-review/SKILL.md
│   │   ├── audit-endpoint/SKILL.md
│   │   └── generate-tests/SKILL.md
│   └── .mcp.json                 # MCP server config
```

**Global configuration:**
```
~/.claude/
├── CLAUDE.md                     # Your personal engineering standards
├── settings.json                 # Global hooks (notifications, safety blocks)
└── agents/
    ├── code-reviewer.md          # Available in every project
    └── perf-analyzer.md
```

**Cloud dev environment:** Set up a Gitpod workspace or a DigitalOcean droplet with:
- Full Claude Code CLI installed and authenticated
- All your MCP servers configured
- Your SSH key from your phone
- Notification hooks that ping your phone when tasks complete

---

### 17.2 The Daily Engineering Workflow

**Morning:**
```
1. Check overnight scheduled task outputs (Claude ran audits while you slept)
2. Open Claude.ai on phone → load yesterday's session summary
3. Plan today's session: what's the ONE thing to advance?
4. Write the session doc: context + today's goal
```

**Feature work:**
```
Step 1 (Architecture): Load SID + feature requirements
  → Ask Claude to generate technical design document
  → Review, mark decisions, push to Notion

Step 2 (Contract): Load tech design
  → Ask Claude to generate TypeScript interfaces + API contract
  → Review every type — this is your contract with yourself

Step 3 (Backend): Load interfaces + relevant CLAUDE.md rules
  → Execute implementation endpoint by endpoint
  → Each endpoint: implement → /production-review → fix findings

Step 4 (Frontend): Load OpenAPI spec + frontend architecture doc
  → Execute component by component
  → Each component: implement → /production-review → fix findings

Step 5 (Tests): Dispatch test-generator subagent on each new file
  → Review test coverage — ask Claude what the tests miss

Step 6 (Integration): Full system self-review
  → "Review the new feature end-to-end against the technical design"
  → Fix gaps
```

---

### 17.3 Avoiding Regressions

1. **Hook:** Tests run automatically after every file edit
2. **Skill:** `/production-review` before any merge
3. **Subagent:** Security reviewer on any auth/authorization code
4. **Document:** Update SID when architecture decisions change
5. **Session rule:** "Before making this change, explain how it affects existing functionality"

---

### 17.4 Scaling the Workflow

**When working solo on a small feature:**
Claude.ai mobile + Projects → direct implementation → self-review loop

**When working on a complex feature:**
SSH to cloud box → Skills + Subagents + Hooks → parallel worktrees → synthesis

**When doing a major audit:**
Cloud box headless → audit pipeline → structured report → prioritized implementation plan

**When shipping:**
GitHub Actions Claude review → auto-blocks on CRITICAL findings → human final review

---

### 17.5 Working Around Mobile Limitations

| Limitation | Workaround |
|---|---|
| Can't run terminal | SSH to cloud dev box |
| Copy/paste friction | Keyboard text replacements for common prompts |
| Small screen | Work document-by-document, not line-by-line |
| No persistent memory | Claude.ai Projects + CLAUDE.md |
| Long prompts hard to type | Voice input + cleanup |
| Multiple files hard to manage | Work through the SID + file references |
| Context collapse | Session summary → new session seeding |
| No file access | Share via Working Copy or cloud git workflow |

---

### 17.6 The Meta-Habit

The engineers who get the most out of this system share one habit: **they write down what works.**

Every time you find a prompt structure that produces exceptional output, it goes into your prompt library. Every architectural decision you explain to Claude goes into your SID. Every workflow that saves you an hour becomes a Skill or a subagent.

Over 6 months, you accumulate a personal engineering system that makes Claude dramatically more effective for your specific work, your specific codebase, and your specific standards — because you've been teaching it the whole time.

That's the real playbook.

---

## Quick Reference Card

### Session starters by task type

| Task | Opening move |
|---|---|
| New feature | Load SID → "Design the technical approach for [feature]" |
| Bug fix | "Diagnose without fixing first: [symptom + recent changes]" |
| Code review | Fresh session → `/production-review` on files |
| Architecture | Load ADRs + SID → "Evaluate approaches to [problem]" |
| Refactor | "Map all callers of [function] before refactoring" |
| DB work | Load schema + relevant migrations → ask for impact analysis |
| Security review | Dispatch security-reviewer subagent |
| Documentation | "Generate docs for [module]: JSDoc + README + gotchas" |

### The 5 things that actually matter

1. **Write your SID.** An hour of writing saves 50 hours of re-explaining.
2. **Build your skills.** The first time you `/production-review` instead of pasting the prompt, you'll understand.
3. **Use subagents for isolation.** Long sessions collapse. Subagents don't.
4. **Hook your tests.** Automatic feedback loops change the quality ceiling.
5. **Read the output.** Every line. You're responsible for it.

---

*Last audited against Claude Code capabilities: May 2026*
*Claude Code: terminal + web + iOS/Android apps + IDE extensions (VS Code, JetBrains)*
*Key features timeline: MCP (Nov 2024) → Subagents (Jul 2025) → Hooks (Sep 2025) → Plugins (Oct 2025) → Skills (Oct 2025) → Agent Teams (Feb 2026)*
