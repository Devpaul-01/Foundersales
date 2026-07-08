# Kith Backend — Complete Testing Guide

> **Your codebase, your rules.** Every section below is grounded in your actual files.  
> No generic theory — if I mention a function, it exists in your code.

---

## Table of Contents

1. [Testing Mindset — The Foundation](#1-testing-mindset)
2. [How to Decide if Something Needs a Test](#2-how-to-decide)
3. [Priority Tier 1 — Test These First (Critical)](#3-tier-1-critical)
4. [Priority Tier 2 — Test These Soon (Important)](#4-tier-2-important)
5. [Priority Tier 3 — Test Eventually (Nice to Have)](#5-tier-3-nice-to-have)
6. [Edge Cases and Risk Areas in Your Code](#6-edge-cases)
7. [Practical Step-by-Step Approach](#7-practical-approach)
8. [Real-World Test Strategy](#8-real-world-strategy)
9. [Common Beginner Mistakes](#9-common-mistakes)
10. [How to Know You're Doing It Right](#10-confidence)
11. [Side Notes on Your Codebase](#11-side-notes)

---

## 1. Testing Mindset

### Why Do We Write Tests?

The honest answer is not "because it's best practice." It's much more personal than that.

You write tests because your brain can only hold so much at once. Right now, you know every corner of your codebase. You remember that `createEntry` checks for duplicate contributions in a 10-minute window. You remember that the `requireMembership` middleware intentionally returns 404 (not 403) to prevent workspace enumeration. You remember all of this — today.

Three months from now, when you're changing the ledger flow, you won't remember all of it. A test is a written-down memory of how your system is supposed to behave. When something breaks, the test tells you *what* broke and *why*, instead of you having to hunt through logs.

Tests also give you confidence to refactor. Without tests, touching `renderTemplate` in `notification.service.js` means you have to manually verify every notification type still works. With tests, you change the function and run them — done in five seconds.

### When Should You Write Tests?

Here is the honest real-world answer: **not everything needs a test, and you don't test everything from day one.**

The approach that actually works in practice:

**Phase 1 (Where you are now):** Write tests for the things most likely to break or most dangerous if they break. Pure functions, auth middleware, role checks, financial logic — these first.

**Phase 2 (As features stabilise):** Add integration tests for full request/response cycles on your most important endpoints.

**Phase 3 (Ongoing):** Every time a bug reaches production, write a test that would have caught it *before* you fix it. This is called a regression test and it's the most valuable test you can write.

### Should I Test Everything From the Start, or Test Manually First?

**Test manually first for new features. Add automated tests for anything that:
- Has been through at least one iteration
- Has non-trivial logic (conditions, calculations, state transitions)
- Would be hard to notice if it broke silently**

Testing everything from scratch is paralysing and slows you down when requirements are still changing. Testing nothing is reckless once things stabilise. The middle path is: build manually, then write tests for the parts that matter.

---

## 2. How to Decide if Something Needs a Test

Ask yourself these four questions:

**1. What breaks if this is wrong?**  
If `requireAdmin` has a bug, any regular member can perform admin actions — delete workspaces, confirm ledger entries, resolve disputes. That's catastrophic. It needs a test.  
If the dashboard's `console.log` format is wrong, nothing breaks. It doesn't need a test.

**2. Is there logic here, or just plumbing?**  
Logic = conditions, calculations, state changes → test it.  
Plumbing = reading from DB, passing to response → lower priority.

**3. Would I notice if this silently broke?**  
`renderTemplate` replaces `{amount}` with real values. If it broke, notifications would show literal `{amount}` text in production. Users would see it, but it would be confusing and embarrassing. Test it.  
`audit.log` is fire-and-forget and never throws. If it silently fails, you lose audit history but users notice nothing. Still worth testing, but lower urgency.

**4. Has this broken before, or could a future developer easily break it?**  
The `daysUntil` calculation in `background.workers.js` (for payment reminders) is easy to get wrong with off-by-one errors. The cycle date math is complex. These need tests.

---

## 3. Tier 1 — Test These First (Critical)

These are the tests you should write before anything else. They protect your most important functionality.

---

### 3.1 `requireAuth` Middleware (`src/middleware/auth.js`)

**Why it's critical:** Every single protected route depends on this. If it has a bug, either everyone gets in without a token, or legitimate users get locked out.

**What to test:**

- A valid Bearer token → calls `next()` and sets `req.user`
- Missing `Authorization` header → throws `UnauthorizedError`
- Header present but no `Bearer ` prefix → throws `UnauthorizedError`
- Supabase returns an error → throws `UnauthorizedError`
- Supabase returns `null` user (no error) → throws `UnauthorizedError`
- Valid token → `req.user.id` and `req.user.email` are correctly set

**Code snippet:**

```javascript
// tests/middleware/auth.test.js
const { requireAuth } = require('../../src/middleware/auth');

// You need to mock supabaseAdmin
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    then: jest.fn().mockResolvedValue({}),
    catch: jest.fn(),
  },
}));

const { supabaseAdmin } = require('../../src/config/supabase');

describe('requireAuth middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {}, requestId: 'test-123', method: 'GET', path: '/test' };
    res = {};
    next = jest.fn();
  });

  it('calls next with UnauthorizedError when no Authorization header', async () => {
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('calls next with UnauthorizedError when header is not Bearer', async () => {
    req.headers.authorization = 'Basic sometoken';
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('sets req.user and calls next() when token is valid', async () => {
    req.headers.authorization = 'Bearer valid-token';
    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@test.com', user_metadata: {} } },
      error: null,
    });
    // Mock the fire-and-forget update
    supabaseAdmin.from.mockReturnValue({ update: () => ({ eq: () => ({ then: jest.fn(), catch: jest.fn() }) }) });

    await requireAuth(req, res, next);

    expect(req.user).toEqual(expect.objectContaining({ id: 'user-1', email: 'test@test.com' }));
    expect(next).toHaveBeenCalledWith(); // called with no arguments = success
  });

  it('calls next with UnauthorizedError when Supabase returns an error', async () => {
    req.headers.authorization = 'Bearer bad-token';
    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Token expired', status: 401 },
    });

    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});
```

---

### 3.2 Role Middleware (`src/middleware/role.js`)

**Why it's critical:** This is a pure, synchronous function with zero dependencies. It's the simplest thing to test and protects every admin-only action: creating members, confirming ledger entries, resolving disputes, deleting workspaces.

**What to test:**

`requireAdmin`:
- `req.member.role === 'admin'` → calls `next()`
- `req.member.role === 'member'` → calls `next(ForbiddenError)`
- `req.member` is null/undefined → calls `next(ForbiddenError)`

`requireSelfOrAdmin`:
- Admin accessing another member's resource → calls `next()`
- Member accessing their own resource → calls `next()`
- Member accessing someone else's resource → calls `next(ForbiddenError)`

**Code snippet:**

```javascript
// tests/middleware/role.test.js
const { requireAdmin, requireSelfOrAdmin } = require('../../src/middleware/role');

describe('requireAdmin', () => {
  it('calls next() for admin role', () => {
    const req = { member: { role: 'admin' } };
    const next = jest.fn();
    requireAdmin(req, {}, next);
    expect(next).toHaveBeenCalledWith(); // no error
  });

  it('calls next(ForbiddenError) for member role', () => {
    const req = { member: { role: 'member' } };
    const next = jest.fn();
    requireAdmin(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('calls next(ForbiddenError) when member is null', () => {
    const req = { member: null };
    const next = jest.fn();
    requireAdmin(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});

describe('requireSelfOrAdmin', () => {
  it('allows admin to access any member', () => {
    const req = { member: { role: 'admin', id: 'admin-1' }, params: { memberId: 'member-99' } };
    const next = jest.fn();
    requireSelfOrAdmin()(req, {}, next);
    expect(next).toHaveBeenCalledWith(); // allowed
  });

  it('allows member to access their own resource', () => {
    const req = { member: { role: 'member', id: 'member-1' }, params: { memberId: 'member-1' } };
    const next = jest.fn();
    requireSelfOrAdmin()(req, {}, next);
    expect(next).toHaveBeenCalledWith(); // allowed
  });

  it('blocks member from accessing someone else\'s resource', () => {
    const req = { member: { role: 'member', id: 'member-1' }, params: { memberId: 'member-2' } };
    const next = jest.fn();
    requireSelfOrAdmin()(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
```

This is an example of the best kind of test to start with: **zero database, zero mocking, purely tests your logic.**

---

### 3.3 `renderTemplate` in Notification Service (`src/services/notification.service.js`)

**Why it's critical:** Every notification sent to users goes through `renderTemplate`. If it has a bug, users see raw placeholder text like `{amount}` or `{actor}` in notifications. It's a pure function with no dependencies — easiest test in the codebase.

**What to test:**
- All `{placeholders}` are replaced with their values
- Missing variable → replaced with empty string (not crash)
- Extra variable (not in template) → no error
- Multiple occurrences of same placeholder all replaced

**Code snippet:**

```javascript
// tests/services/notification.test.js
const { renderTemplate } = require('../../src/services/notification.service');

describe('renderTemplate', () => {
  it('replaces a single placeholder', () => {
    expect(renderTemplate('Hello {name}', { name: 'Seyi' })).toBe('Hello Seyi');
  });

  it('replaces multiple different placeholders', () => {
    const result = renderTemplate('{actor} submitted {amount} for {container}', {
      actor: 'Seyi', amount: '500 GBP', container: 'Christmas Fund'
    });
    expect(result).toBe('Seyi submitted 500 GBP for Christmas Fund');
  });

  it('replaces multiple occurrences of the same placeholder', () => {
    expect(renderTemplate('{name} is {name}', { name: 'Seyi' })).toBe('Seyi is Seyi');
  });

  it('replaces missing variable with empty string, not crash', () => {
    const result = renderTemplate('Hello {name}', {}); // name not provided
    expect(result).toBe('Hello '); // empty string, not "{name}"
  });

  it('handles null/undefined values gracefully', () => {
    const result = renderTemplate('Amount: {amount}', { amount: null });
    expect(result).toBe('Amount: ');
  });
});
```

---

### 3.4 `mapSupabaseAuthError` (`src/controllers/auth.controller.js`)

**Why it's critical:** This function converts raw Supabase error messages into proper app errors. If the mapping is wrong, users get confusing error messages, or worse — the wrong HTTP status code. It's a pure function so it's trivial to test.

**What to test:**
- `"already registered"` → `ConflictError` (409)
- `"Email not confirmed"` → `BusinessRuleError` (422)
- `"Invalid login credentials"` → `UnauthorizedError` (401)
- `"Email rate limit exceeded"` → 429 error
- Unknown error → generic 400

**Code snippet:**

```javascript
// Since mapSupabaseAuthError is not exported, you test it via the login/signup
// endpoints, OR you refactor to export it. For now, test through the endpoint:

describe('POST /auth/login', () => {
  it('returns 401 for invalid credentials', async () => {
    // Mock supabaseAuth to return the Supabase error
    // Then check the response is 401 with a clean message
  });
});

// --- OR --- extract and export mapSupabaseAuthError from auth.controller.js
// This is the better approach. Add to the bottom of auth.controller.js:
// module.exports = { ..., mapSupabaseAuthError }; // for testing only
```

> **Tip:** If a function is hard to test because it's not exported, that's a signal you should extract it. Good code structure and good testability go hand in hand.

---

### 3.5 `errorHandler` Middleware (`src/middleware/errorHandler.js`)

**Why it's critical:** Your error handler is the last line of defence. If it misclassifies errors, clients get wrong status codes. If it leaks stack traces in production, you have a security problem.

**What to test:**
- `ZodError` → 400 with `VALIDATION_FAILED` and field path
- `AppError` (e.g., `NotFoundError`) → its statusCode and code
- Postgres `23505` duplicate → 409 `CONFLICT`
- Postgres `23503` foreign key → 422 `BUSINESS_RULE_VIOLATION`
- Unknown error in production → 500 with `"An internal error occurred"` (not the real message)
- Unknown error in development → 500 with the real message

**Code snippet:**

```javascript
// tests/middleware/errorHandler.test.js
const { errorHandler } = require('../../src/middleware/errorHandler');
const { ZodError } = require('zod');
const { NotFoundError } = require('../../src/utils/errors');

describe('errorHandler', () => {
  let res, next;

  beforeEach(() => {
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
  });

  it('returns 400 for ZodError', () => {
    // Create a real ZodError by parsing bad data
    const { z } = require('zod');
    let zodErr;
    try { z.object({ name: z.string() }).parse({ name: 123 }); }
    catch (e) { zodErr = e; }

    errorHandler(zodErr, {}, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'VALIDATION_FAILED' })
    }));
  });

  it('returns 404 for NotFoundError', () => {
    errorHandler(new NotFoundError('Workspace not found'), {}, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 409 for Postgres duplicate key error', () => {
    const pgErr = new Error('duplicate'); pgErr.code = '23505';
    errorHandler(pgErr, {}, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('hides real error message in production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    errorHandler(new Error('Secret internal detail'), {}, res, next);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: 'An internal error occurred' }) })
    );
    process.env.NODE_ENV = original;
  });
});
```

---

## 4. Tier 2 — Test These Soon (Important)

These tests protect business logic that's more complex. Write these after your Tier 1 tests are passing.

---

### 4.1 Ledger Entry Business Rules (`src/controllers/ledger.controller.js`)

Your ledger is the financial core of Kith. The `createEntry` function has multiple layered rules that absolutely need tests.

**What to test:**

- A non-admin submitting with `contributor_id !== their own id` → `ForbiddenError`
- Contributor not in the container → `BusinessRuleError`
- Duplicate detection: same contributor, same amount, within 10 minutes → `ConflictError`
- Duplicate detection bypassed with `?force=true` → entry created
- Admin-submitted entry → status is `'confirmed'` immediately
- Non-admin-submitted entry → status is `'pending'`
- Invalid `cycle_id` (not belonging to this container) → `BusinessRuleError`

**Edge cases to think about:**
- What if `recorded_at` is exactly 10 minutes ago? Off-by-one — test the boundary.
- What if `original_amount` is 0? Is that valid?
- What if `contributor_id` belongs to a proxy member and caller is not admin?

---

### 4.2 `requireMembership` Middleware (`src/middleware/workspace.js`)

**What to test:**

- Valid active member → `req.member` and `req.workspace` are set correctly
- Member exists but `is_active = false` → `NotFoundError` (not 403)
- Member exists but `deleted_at` is set → `NotFoundError`
- Member's workspace has `deleted_at` set → `NotFoundError`
- User has no membership at all in that workspace → `NotFoundError`

The key thing here is: **the function intentionally returns 404 instead of 403** to prevent workspace enumeration. Test that this is actually the behaviour.

---

### 4.3 Dispute State Machine (`src/controllers/dispute.controller.js`)

Disputes have a clear state machine: `open → resolved`. There's no going backwards.

**What to test:**

- Raising a dispute on a `confirmed` or `pending` entry → succeeds, entry status becomes `'disputed'`
- Raising a dispute on a `disputed` or `resolved` entry → `BusinessRuleError`
- Non-admin trying to dispute someone else's entry → `ForbiddenError`
- Resolving a dispute that's already resolved → `BusinessRuleError` (`'Dispute is already resolved'`)
- On resolution, the related ledger entry status changes to `'resolved'`
- Adding a note to a resolved dispute by a non-admin → `ForbiddenError`

---

### 4.4 Payment Reminder Date Logic (`src/workers/background.workers.js`)

This is the most mathematically fragile part of your codebase. The `daysUntil` calculation determines whether to send a reminder or an overdue notice.

**What to test:**

```javascript
// The core calculation you want to isolate and test:
// daysUntil = Math.ceil((dueDate - today) / 86400000)

describe('reminder date calculation', () => {
  it('daysUntil is 3 when due date is 3 days away', () => {
    const today = new Date('2025-01-01');
    const dueDate = new Date('2025-01-04');
    const daysUntil = Math.ceil((dueDate - today) / 86400000);
    expect(daysUntil).toBe(3);
  });

  it('daysUntil is 0 on the due date itself', () => {
    const today = new Date('2025-01-01');
    const dueDate = new Date('2025-01-01');
    const daysUntil = Math.ceil((dueDate - today) / 86400000);
    expect(daysUntil).toBe(0); // Should trigger reminder? Check your logic.
  });

  it('daysOverdue is 1 one day after due date', () => {
    const today = new Date('2025-01-02');
    const dueDate = new Date('2025-01-01');
    const daysUntil = Math.ceil((dueDate - today) / 86400000); // -1
    const daysOverdue = -daysUntil; // 1
    expect(daysOverdue).toBe(1);
  });
});
```

> **Recommendation:** Extract this date logic into a small helper function so you can test it directly without mocking BullMQ and Supabase.

---

### 4.5 Notification Deduplication (`src/services/notification.service.js`)

**What to test:**

- `buildDedupKey` generates consistent, predictable keys
- `buildDedupKey` with no optional fields → returns just the type
- `buildDedupKey` with all fields → includes all parts in the right order
- When a dedup key is already in the DB, `_sendToRecipient` skips insertion (returns early on `!inserted`)

```javascript
describe('buildDedupKey', () => {
  // buildDedupKey is not exported — add it to exports or test via send()
  it('generates key with type only when no other fields', () => {
    // If exported: expect(buildDedupKey('task_assigned', {})).toBe('task_assigned');
  });

  it('includes participant_id and container_id when provided', () => {
    const key = buildDedupKey('payment_reminder', { participant_id: 'p1', container_id: 'c1' });
    expect(key).toBe('payment_reminder:p1:c1');
  });
});
```

---

## 5. Tier 3 — Test Eventually (Nice to Have)

These are lower risk but worth adding as your test suite matures.

---

### 5.1 `audit.service.js` — `fromReq`

`fromReq` is a pure helper. Test that it correctly extracts from `req.member`, `req.user`, and `req.headers`. No DB mock needed.

```javascript
it('extracts correct fields from req', () => {
  const req = {
    member: { workspaceId: 'ws-1', id: 'mem-1' },
    user: { id: 'user-1' },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'TestAgent/1.0' },
  };
  expect(fromReq(req)).toEqual({
    workspaceId: 'ws-1', actorUserId: 'user-1', actorMemberId: 'mem-1',
    ipAddress: '127.0.0.1', userAgent: 'TestAgent/1.0',
  });
});
```

### 5.2 `loadDbUser` Middleware

Tests: user found → sets `req.dbUser`; soft-deleted user (has `deleted_at`) → `UnauthorizedError`; user not found → `UnauthorizedError`.

### 5.3 Auth Controller — `signup` and `login`

These are harder to test because they touch Supabase Auth. Test them with full mocking of `supabaseAuth`. Key scenarios: successful signup creates user profile row; successful login returns tokens AND memberships; login with unconfirmed email gets the right error message.

### 5.4 Scheduler Job Registration

Test that `setupScheduler` registers the right jobs in the right queues. Mock the BullMQ `Queue` class and assert that `queue.add` was called with each job name mapped to its correct queue name.

### 5.5 `firebase.js` — `getFirebaseApp`

Test: returns `null` (not throws) when `FIREBASE_SERVICE_ACCOUNT` env var is missing; initialises and returns an app when it's present; returns cached instance on second call (singleton).

---

## 6. Edge Cases and Risk Areas in Your Code

These are the specific places in your codebase most likely to cause bugs in production.

---

### Risk 1: `auth.js` — Verbose Console Logging in Production

**File:** `src/middleware/auth.js`

Your `requireAuth` middleware has dozens of `console.log` calls, including logging the user's email, full name, last sign-in time, and partial token content. This is fine for debugging but **should not run in production**. It creates noise in production logs and leaks PII.

**Recommendation:** Wrap all the debug `console.log` calls in an `if (process.env.NODE_ENV !== 'production')` guard, or replace them entirely with your `logger.debug()` calls which you're already making. The `logger` respects log levels — `console.log` does not.

**Test:** Write a test that confirms `requireAuth` does not call `console.log` with user email when `NODE_ENV = 'production'`.

---

### Risk 2: Cycle Date Math — Off-by-One Errors

**File:** `src/workers/background.workers.js` — `createCycleGenerationWorker`

```javascript
case 'monthly': cycleEnd.setMonth(cycleEnd.getMonth() + 1); cycleEnd.setDate(cycleEnd.getDate() - 1); break;
```

Month-boundary math in JavaScript is famously tricky. January 31 + 1 month = March 3 in JavaScript (not February 28). The `setDate(-1)` subtraction can also produce unexpected results near month boundaries.

**Edge cases to test:**
- Cycle starting January 31 → does it end February 28 or roll over to March?
- Cycle starting December 1, yearly cadence → ends November 30 next year?
- `custom` cadence with 0 `recurrence_days` → what happens?
- `recurrence_end` set in the past → should generate zero cycles

---

### Risk 3: `getFirebaseApp` Singleton — Module Caching Across Tests

**File:** `src/config/firebase.js`

The `firebaseApp` variable is module-level, so once initialised it's cached for the lifetime of the process. In tests, if one test initialises Firebase, subsequent tests get the cached instance even if they set different env vars. You need to use `jest.resetModules()` or `jest.isolateModules()` when testing Firebase initialisation.

---

### Risk 4: Notification Worker — Double Retry Count Update

**File:** `src/workers/notification_worker.js`

```javascript
// First update (doesn't actually update retry_count)
await supabaseAdmin.from('notification_deliveries')
  .update({ last_attempt_at: ..., retry_count: undefined })
  .eq('id', delivery_id);

// Second update (actually increments)
const { data: current } = await supabaseAdmin
  .from('notification_deliveries').select('retry_count').eq('id', delivery_id).single();
await supabaseAdmin.from('notification_deliveries')
  .update({ retry_count: (current?.retry_count || 0) + 1 })
  .eq('id', delivery_id);
```

There are two separate DB calls to increment retry_count — the first one sets `retry_count: undefined` (no-op), then the second one reads and increments. Under concurrent load (BullMQ concurrency is 10 here), two workers could read the same `retry_count: 0`, both increment to 1, and you lose count accuracy. This is a race condition.

**Test to write:** Simulate two concurrent notifications for the same delivery_id and verify retry_count ends at 2, not 1.

---

### Risk 5: Dashboard `participantCount` Variable

**File:** `src/controllers/workspace.controller.js`, line ~218

```javascript
participant_count: participantCount, // ← this variable is never defined!
```

You reference `participantCount` in the dashboard's event mapping, but looking at the query, only `container_participants(id)` is selected. The actual count calculation using that data is missing — `participantCount` will be `undefined` in the response. Write a test for `GET /workspaces/:id/dashboard` that checks `active_events[0].participant_count` is a number, not `undefined`.

---

### Risk 6: Workspace Enumeration Guard

**File:** `src/middleware/workspace.js`

The comment says it returns 404 "never 403" to prevent workspace enumeration. This is intentional security-by-design. But it means:

**Edge case to test:** A user who is a member of workspace A should get 404 (not 403) when trying to access workspace B they don't belong to. If someone accidentally changes this to a 403 in future, the security property is broken.

```javascript
it('returns 404 (not 403) when user is not a member of the workspace', async () => {
  // Ensures enumeration prevention is working
  expect(response.status).toBe(404);
  expect(response.status).not.toBe(403);
});
```

---

### Risk 7: `updateContacts` Delete-Then-Insert Pattern

**File:** `src/controllers/auth.controller.js` — `updateContacts`

```javascript
await supabaseAdmin.from('user_contacts').delete().eq('user_id', userId).in('type', types);
// Then loop and upsert each contact
for (const contact of data.contacts) { await supabaseAdmin.from('user_contacts').upsert(...); }
```

This pattern (delete then re-insert in a loop) has two problems:
1. If the upsert fails halfway through, some contacts are deleted but not re-inserted. No transaction wrapping this.
2. N sequential DB calls instead of one bulk operation.

**Test to write:** Send a PATCH with three contacts where the second one has invalid data. Verify the first contact is not lost (which it would be with the current delete-first approach).

---

## 7. Practical Step-by-Step Approach

Here is the exact sequence I'd recommend for writing your first tests.

### Step 1: Set Up Your Testing Environment

```bash
npm install --save-dev jest
```

Add to `package.json`:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/tests/**/*.test.js"]
  }
}
```

Create this folder structure:
```
tests/
  middleware/
    auth.test.js
    role.test.js
    errorHandler.test.js
  services/
    notification.test.js
    audit.test.js
  controllers/
    ledger.test.js
    dispute.test.js
  workers/
    reminder.test.js
```

### Step 2: Write Your First Test (Role Middleware)

Start with `role.js` — it has zero dependencies. You don't need to mock anything. Writing this first gives you a working test with a passing output before you deal with the complexity of mocking Supabase.

### Step 3: Write Tests for Pure Functions

After `role.js`, write tests for `renderTemplate` and `buildDedupKey` in `notification.service.js`. Then `fromReq` in `audit.service.js`. Then `mapSupabaseAuthError` in `auth.controller.js`.

These four function tests will build your confidence and can be done in a single sitting.

### Step 4: Add Mocking for Middleware Tests

Now tackle `errorHandler.test.js` (minimal mocking — just mock the `res` object) and then `auth.test.js` (requires mocking `supabaseAdmin`).

The key concept: mocking means replacing a real dependency with a fake one that you control. You do this so your tests don't require a live Supabase connection.

```javascript
// Mock pattern for supabaseAdmin
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    auth: { getUser: jest.fn() },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));
```

### Step 5: Write One Integration Test

An integration test actually runs an HTTP request against your Express app without a live DB. Use `supertest`:

```bash
npm install --save-dev supertest
```

```javascript
const request = require('supertest');
const app = require('../../src/app');

describe('POST /auth/login', () => {
  it('returns 400 for missing email', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ password: 'test' }); // missing email
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
```

---

## 8. Real-World Test Strategy

### How Developers Actually Approach This

In real production teams, testing follows a pyramid:

```
        /\
       /  \        ← Few: End-to-End tests (Postman / real DB)
      /----\
     /      \      ← Some: Integration tests (supertest, mocked DB)
    /--------\
   /          \    ← Many: Unit tests (pure functions, middleware)
  /____________\
```

You want lots of unit tests (fast, cheap, zero dependencies), fewer integration tests, and very few end-to-end tests. Right now you're manually doing the E2E layer. Your job is to move more of that into automated unit and integration tests.

### What to Test First in a Large Codebase

Use this priority formula:

> **Priority = Likelihood of Breaking × Severity of Breaking**

| Component | Breaks Often? | Severe if Broken? | Priority |
|---|---|---|---|
| `requireAdmin` | Rarely | Catastrophic (security) | **Highest** |
| `requireAuth` | Rarely | Catastrophic (security) | **Highest** |
| `renderTemplate` | Could after refactor | High (UX) | **High** |
| Ledger business rules | On every change | High (financial) | **High** |
| Cycle date math | On every change | Medium | **Medium** |
| Dashboard queries | On schema change | Low (visible but non-critical) | **Medium** |
| `audit.log` | Rarely | Low (fire-and-forget) | **Low** |
| `exportLedger` | Rarely | Low | **Low** |

### How to Gradually Improve Coverage

Don't try to get to 100% coverage. That goal leads to writing useless tests just to hit a number.

Instead, use this rule: **"Coverage should tell you what you haven't thought about."** Run `jest --coverage`, look at the uncovered lines, and ask: "Would I notice if this broke?" If yes, write a test. If no, leave it.

**Realistic coverage targets:**
- Middleware: 90%+
- Services (business logic): 80%+
- Controllers: 60%+
- Workers: 50%+
- Config files: skip for now

---

## 9. Common Beginner Mistakes

### Mistake 1: Testing Implementation, Not Behaviour

❌ Wrong — testing how it works internally:
```javascript
it('calls supabaseAdmin.from with workspace_members', () => {
  expect(supabaseAdmin.from).toHaveBeenCalledWith('workspace_members');
});
```

✅ Right — testing what it does:
```javascript
it('returns 404 when user is not a member', async () => {
  expect(res.status).toBe(404);
});
```

If you refactor internally (change the DB query structure), the wrong test breaks. The right test stays green.

### Mistake 2: Testing the Framework, Not Your Code

You don't need to test that Express correctly parses JSON, or that Supabase returns data you told it to return. Test your logic on top of those things.

### Mistake 3: Not Resetting Mocks Between Tests

```javascript
beforeEach(() => {
  jest.clearAllMocks(); // ALWAYS do this
});
```

If you don't clear mocks, call counts and return values leak between tests, causing random failures that are impossible to debug.

### Mistake 4: Over-Mocking

If your test has 50 lines of mock setup and 3 lines of actual assertion, the test is probably testing the wrong thing. Extract the logic into a smaller pure function and test that directly.

### Mistake 5: Writing Tests That Always Pass

```javascript
// This test will always pass — it proves nothing
it('does something', () => {
  expect(true).toBe(true);
});
```

Every test should be capable of failing. Before committing a test, briefly break the code it's testing and verify the test actually goes red.

### Mistake 6: Ignoring the Unhappy Path

Most bugs happen in edge cases and error scenarios, not the happy path. For every feature, write at least one test for what happens when it *fails*.

### Mistake 7: Huge Test Files

Don't put all your tests in one file. One test file per module. Follow the same folder structure as your source code.

---

## 10. How to Know You're Doing It Right

You're on the right track when:

**Your tests break when they should.** Before merging every code change, one of your tests should catch the bug you accidentally introduced. If you go weeks without a test failing, you may not have enough tests — or they may be testing the wrong things.

**You can change code without fear.** When you refactor `renderTemplate`, you run your tests and trust the output. You don't manually test every notification.

**New developers can understand behaviour from tests.** Your tests act as documentation. Someone reading `role.test.js` immediately understands the access control rules without reading the implementation.

**You find bugs in tests, not production.** Over time, the ratio of "bugs caught by tests" vs "bugs reported by users" should shift. Track it.

**How to improve over time:**
1. After every production bug: write a regression test before fixing it
2. Once a month: run `jest --coverage` and look at what's uncovered
3. Before every major refactor: make sure the area you're changing has tests
4. When onboarding a new feature: write at least one test before shipping

---

## 11. Side Notes on Your Codebase

These aren't blocking issues, but worth knowing as you grow:

**1. Console.log volume is high.**  
`auth.js`, `workspace.controller.js` (getDashboard), and `workspace.controller.js` (createWorkspace) all have heavy `console.log` usage. This is normal during development but should be replaced with structured `logger` calls before production. `console.log` has no log levels, no structured output, and can't be silenced without hacking stdout.

**2. `requireMembership` always does two DB calls.**  
It fetches the member first, then the workspace separately. These could be combined into a single join query to halve the DB round trips on every workspace-scoped request. Not critical — just worth knowing.

**3. `notification.worker.js` has a retry_count race condition.**  
Described in Risk 4 above. Low impact at low scale, but worth fixing before you have concurrent users.

**4. `mapSupabaseAuthError` deserves to be exported.**  
It's a valuable, independently-testable function. Export it from `auth.controller.js` and write dedicated unit tests for it. This is the easiest win for your auth test coverage.

**5. `buildDedupKey` in `notification.service.js` should be exported.**  
Same reason — it's a pure function that deserves its own tests. Without exporting it, you can only test it indirectly through `send()`, which requires mocking the entire notification pipeline.

---

*That's everything. Start with Tier 1 — role middleware first, since it has zero setup cost. Once you have a green test run for even one file, the momentum carries you forward.*
