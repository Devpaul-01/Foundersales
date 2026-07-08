# Kith Backend — Test Starters

> **Companion to `kith-testing-guide.md`.**  
> These are real, runnable test files. Drop them into your project, run `npm test`, and they should either pass or show you exactly what to fix. Start from the top and work down.

---

## Setup First — Do This Once

### 1. Install dependencies

```bash
npm install --save-dev jest supertest
```

### 2. Add to `package.json`

```json
{
  "scripts": {
    "test":          "jest --forceExit",
    "test:watch":    "jest --watch --forceExit",
    "test:coverage": "jest --coverage --forceExit"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/tests/**/*.test.js"],
    "clearMocks": true,
    "collectCoverageFrom": [
      "src/**/*.js",
      "!src/config/**",
      "!src/server.js"
    ]
  }
}
```

> **Why `--forceExit`?** BullMQ and Supabase clients keep open connections. Without it, Jest hangs forever after tests finish.

### 3. Create your folder structure

```
tests/
  helpers/
    mocks.js                   <- Shared mock factory — create this first
  middleware/
    role.test.js               <- Start here. Zero mocking needed.
    errorHandler.test.js
    auth.test.js
    workspace.test.js
  services/
    notification.test.js
    audit.test.js
  controllers/
    ledger.test.js
    dispute.test.js
  workers/
    reminder.test.js
```

---

## `tests/helpers/mocks.js`

Create this before anything else. Every test file will import from here.

```javascript
// tests/helpers/mocks.js

/**
 * Creates a chainable Supabase query builder mock.
 *
 * Every method (select, eq, is, order, etc.) returns `this` so chains work.
 * Terminal methods (single, maybeSingle) resolve to { data: null, error: null }
 * by default — override per-test with mockReturnValueOnce.
 */
function createSupabaseMock() {
  function makeChain() {
    const chain = {
      select:      jest.fn().mockReturnThis(),
      insert:      jest.fn().mockReturnThis(),
      update:      jest.fn().mockReturnThis(),
      upsert:      jest.fn().mockReturnThis(),
      delete:      jest.fn().mockReturnThis(),
      eq:          jest.fn().mockReturnThis(),
      neq:         jest.fn().mockReturnThis(),
      is:          jest.fn().mockReturnThis(),
      in:          jest.fn().mockReturnThis(),
      lt:          jest.fn().mockReturnThis(),
      lte:         jest.fn().mockReturnThis(),
      gte:         jest.fn().mockReturnThis(),
      not:         jest.fn().mockReturnThis(),
      or:          jest.fn().mockReturnThis(),
      order:       jest.fn().mockReturnThis(),
      limit:       jest.fn().mockReturnThis(),
      range:       jest.fn().mockReturnThis(),
      single:      jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      // Fire-and-forget chains (e.g. auth middleware last_seen_at update)
      then:        jest.fn().mockResolvedValue({ data: null, error: null }),
      catch:       jest.fn().mockReturnThis(),
    };
    return chain;
  }

  const supabaseMock = {
    from: jest.fn().mockImplementation(() => makeChain()),
    auth: {
      getUser: jest.fn(),
      admin: {
        getUserById:    jest.fn(),
        signOut:        jest.fn(),
        updateUserById: jest.fn(),
      },
    },
    rpc: jest.fn(),
  };

  return supabaseMock;
}

/** Minimal Express req object — override what you need */
function buildReq(overrides = {}) {
  return {
    headers:   {},
    params:    {},
    query:     {},
    body:      {},
    ip:        '127.0.0.1',
    requestId: 'test-req-id',
    method:    'GET',
    path:      '/test',
    user:      null,
    member:    null,
    workspace: null,
    dbUser:    null,
    ...overrides,
  };
}

/** Minimal Express res object with jest spies */
function buildRes() {
  return {
    status:    jest.fn().mockReturnThis(),
    json:      jest.fn().mockReturnThis(),
    send:      jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
}

/** Standard workspace member for req.member */
function buildMember(overrides = {}) {
  return {
    id:          'member-test-1',
    role:        'member',
    displayName: 'Test User',
    isProxy:     false,
    isActive:    true,
    workspaceId: 'workspace-test-1',
    ...overrides,
  };
}

/** Standard workspace for req.workspace */
function buildWorkspace(overrides = {}) {
  return {
    id:           'workspace-test-1',
    name:         'Test Family',
    baseCurrency: 'GBP',
    plan:         'free',
    visibility:   'private',
    ...overrides,
  };
}

/** Standard auth user for req.user */
function buildUser(overrides = {}) {
  return {
    id:        'user-test-1',
    email:     'test@example.com',
    full_name: 'Test User',
    ...overrides,
  };
}

module.exports = {
  createSupabaseMock,
  buildReq,
  buildRes,
  buildMember,
  buildWorkspace,
  buildUser,
};
```

---

## `tests/middleware/role.test.js`

**Start here. No mocking. No DB. Run this first.**

```javascript
// tests/middleware/role.test.js
const { requireAdmin, requireSelfOrAdmin } = require('../../src/middleware/role');
const { buildReq, buildRes, buildMember }  = require('../helpers/mocks');

describe('requireAdmin', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
  });

  it('calls next() with no args when member is admin', () => {
    const req = buildReq({ member: buildMember({ role: 'admin' }) });
    requireAdmin(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next(ForbiddenError 403) when role is "member"', () => {
    const req = buildReq({ member: buildMember({ role: 'member' }) });
    requireAdmin(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('calls next(ForbiddenError 403) when req.member is null', () => {
    const req = buildReq({ member: null });
    requireAdmin(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('calls next(ForbiddenError 403) when req.member is undefined', () => {
    const req = buildReq();
    delete req.member;
    requireAdmin(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('error message says "Admin access required"', () => {
    const req = buildReq({ member: buildMember({ role: 'member' }) });
    requireAdmin(req, buildRes(), next);
    const err = next.mock.calls[0][0];
    expect(err.message).toMatch(/admin access required/i);
  });
});

// -----------------------------------------------------------------------------

describe('requireSelfOrAdmin', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
  });

  describe('admin caller', () => {
    it('allows admin to access their own resource', () => {
      const req = buildReq({
        member: buildMember({ role: 'admin', id: 'admin-1' }),
        params: { memberId: 'admin-1' },
      });
      requireSelfOrAdmin()(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('allows admin to access any other member resource', () => {
      const req = buildReq({
        member: buildMember({ role: 'admin', id: 'admin-1' }),
        params: { memberId: 'member-99' },
      });
      requireSelfOrAdmin()(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('regular member caller', () => {
    it('allows member to access their own resource', () => {
      const req = buildReq({
        member: buildMember({ role: 'member', id: 'member-1' }),
        params: { memberId: 'member-1' },
      });
      requireSelfOrAdmin()(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('blocks member from accessing another member resource', () => {
      const req = buildReq({
        member: buildMember({ role: 'member', id: 'member-1' }),
        params: { memberId: 'member-2' },
      });
      requireSelfOrAdmin()(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 403 })
      );
    });

    it('uses a custom getMemberId function when provided', () => {
      // ID comes from body instead of params
      const req = buildReq({
        member: buildMember({ role: 'member', id: 'member-1' }),
        body:   { target_id: 'member-2' },
        params: {},
      });
      const getMemberId = (r) => r.body.target_id;
      requireSelfOrAdmin(getMemberId)(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 403 })
      );
    });
  });
});
```

---

## `tests/middleware/errorHandler.test.js`

```javascript
// tests/middleware/errorHandler.test.js
const { z }            = require('zod');
const { errorHandler } = require('../../src/middleware/errorHandler');
const {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  BusinessRuleError,
} = require('../../src/utils/errors');
const { buildReq, buildRes } = require('../helpers/mocks');

// Helper: run the handler and return { status, body }
function handle(err, nodeEnv = 'test') {
  const savedEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;

  const req = buildReq({ requestId: 'test-123' });
  const res = buildRes();
  errorHandler(err, req, res, jest.fn());

  process.env.NODE_ENV = savedEnv;
  return {
    status: res.status.mock.calls[0][0],
    body:   res.json.mock.calls[0][0],
  };
}

// Helper: produce a real ZodError by intentionally failing a parse
function makeZodError() {
  try {
    z.object({ name: z.string(), age: z.number() }).parse({ name: 123, age: 'old' });
  } catch (e) {
    return e;
  }
}

// -----------------------------------------------------------------------------

describe('errorHandler — Zod validation errors', () => {
  it('returns 400 with VALIDATION_FAILED code', () => {
    const { status, body } = handle(makeZodError());
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('includes a field path in the error response', () => {
    const { body } = handle(makeZodError());
    expect(body.error.field).toBeDefined();
    expect(typeof body.error.field).toBe('string');
  });

  it('includes a details array for all failing fields', () => {
    const { body } = handle(makeZodError());
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThanOrEqual(1);
  });
});

// -----------------------------------------------------------------------------

describe('errorHandler — AppError subclasses', () => {
  it('returns 404 for NotFoundError', () => {
    const { status, body } = handle(new NotFoundError('Workspace not found'));
    expect(status).toBe(404);
    expect(body.error.message).toBe('Workspace not found');
  });

  it('returns 401 for UnauthorizedError', () => {
    const { status } = handle(new UnauthorizedError('Not authenticated'));
    expect(status).toBe(401);
  });

  it('returns 403 for ForbiddenError', () => {
    const { status } = handle(new ForbiddenError('Admin only'));
    expect(status).toBe(403);
  });

  it('returns 409 for ConflictError', () => {
    const { status } = handle(new ConflictError('Already exists'));
    expect(status).toBe(409);
  });

  it('returns 422 for BusinessRuleError', () => {
    const { status } = handle(new BusinessRuleError('Rule violated'));
    expect(status).toBe(422);
  });

  it('returns 400 for ValidationError', () => {
    const { status } = handle(new ValidationError('Bad value', 'email'));
    expect(status).toBe(400);
  });

  it('includes field property when error has a field', () => {
    const { body } = handle(new ValidationError('Bad value', 'email'));
    expect(body.error.field).toBe('email');
  });

  it('does not include field property when error has no field', () => {
    const { body } = handle(new NotFoundError('Not found'));
    expect(body.error.field).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------

describe('errorHandler — Postgres errors', () => {
  it('returns 409 CONFLICT for Postgres 23505 (unique violation)', () => {
    const err  = new Error('duplicate key');
    err.code   = '23505';
    const { status, body } = handle(err);
    expect(status).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
  });

  it('returns 422 BUSINESS_RULE_VIOLATION for Postgres 23503 (foreign key)', () => {
    const err  = new Error('foreign key violation');
    err.code   = '23503';
    const { status, body } = handle(err);
    expect(status).toBe(422);
    expect(body.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });
});

// -----------------------------------------------------------------------------

describe('errorHandler — unhandled errors', () => {
  it('returns 500 for unknown errors', () => {
    const { status } = handle(new Error('Something broke'));
    expect(status).toBe(500);
  });

  it('hides the real message in production', () => {
    const { body } = handle(new Error('Secret DB connection string'), 'production');
    expect(body.error.message).toBe('An internal error occurred');
    expect(body.error.message).not.toContain('Secret');
  });

  it('shows the real message outside production', () => {
    const { body } = handle(new Error('Real error detail'), 'development');
    expect(body.error.message).toBe('Real error detail');
  });

  it('always uses INTERNAL_ERROR code for unknown errors', () => {
    const { body } = handle(new Error('boom'));
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
```

---

## `tests/middleware/auth.test.js`

```javascript
// tests/middleware/auth.test.js

// Mock BEFORE requiring the module under test
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn().mockReturnValue({
      update:      jest.fn().mockReturnThis(),
      eq:          jest.fn().mockReturnThis(),
      select:      jest.fn().mockReturnThis(),
      is:          jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      then:        jest.fn().mockResolvedValue({ data: null, error: null }),
      catch:       jest.fn().mockReturnThis(),
    }),
  },
}));

const { requireAuth, loadDbUser } = require('../../src/middleware/auth');
const { supabaseAdmin }           = require('../../src/config/supabase');
const { buildReq, buildRes }      = require('../helpers/mocks');

// -----------------------------------------------------------------------------

describe('requireAuth', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();

    // Default: fire-and-forget last_seen_at update is a no-op
    supabaseAdmin.from.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockReturnThis(),
      then:   jest.fn().mockResolvedValue({ data: null, error: null }),
      catch:  jest.fn().mockReturnThis(),
    });
  });

  describe('missing / malformed Authorization header', () => {
    it('returns 401 when Authorization header is absent', async () => {
      const req = buildReq({ headers: {} });
      await requireAuth(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 })
      );
    });

    it('returns 401 when header does not start with "Bearer "', async () => {
      const req = buildReq({ headers: { authorization: 'Basic abc123' } });
      await requireAuth(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 })
      );
    });

    it('returns 401 for lowercase "bearer " — scheme is case-sensitive', async () => {
      const req = buildReq({ headers: { authorization: 'bearer mytoken' } });
      await requireAuth(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 })
      );
    });
  });

  describe('Supabase verification failures', () => {
    it('returns 401 when Supabase returns an error', async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data:  { user: null },
        error: { message: 'Token expired', status: 401, name: 'AuthApiError' },
      });
      const req = buildReq({ headers: { authorization: 'Bearer expired-token' } });
      await requireAuth(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 })
      );
    });

    it('returns 401 when Supabase returns no error but user is null', async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data:  { user: null },
        error: null,
      });
      const req = buildReq({ headers: { authorization: 'Bearer ghost-token' } });
      await requireAuth(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 })
      );
    });
  });

  describe('successful authentication', () => {
    beforeEach(() => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id:                 'user-abc',
            email:              'seyi@example.com',
            user_metadata:      { full_name: 'Seyi' },
            email_confirmed_at: '2024-01-01T00:00:00Z',
            last_sign_in_at:    '2025-01-01T00:00:00Z',
            created_at:         '2024-01-01T00:00:00Z',
          },
        },
        error: null,
      });
    });

    it('calls next() with no arguments on a valid token', async () => {
      const req = buildReq({ headers: { authorization: 'Bearer valid-token' } });
      await requireAuth(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('sets req.user.id correctly', async () => {
      const req = buildReq({ headers: { authorization: 'Bearer valid-token' } });
      await requireAuth(req, buildRes(), next);
      expect(req.user.id).toBe('user-abc');
    });

    it('sets req.user.email correctly', async () => {
      const req = buildReq({ headers: { authorization: 'Bearer valid-token' } });
      await requireAuth(req, buildRes(), next);
      expect(req.user.email).toBe('seyi@example.com');
    });

    it('sets req.user.full_name from user_metadata', async () => {
      const req = buildReq({ headers: { authorization: 'Bearer valid-token' } });
      await requireAuth(req, buildRes(), next);
      expect(req.user.full_name).toBe('Seyi');
    });

    it('does NOT block the request when last_seen_at update fails silently', async () => {
      // The update is fire-and-forget — even if it errors, next() is still called
      supabaseAdmin.from.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnThis(),
        then:   jest.fn().mockRejectedValue(new Error('DB timeout')),
        catch:  jest.fn().mockReturnThis(),
      });
      const req = buildReq({ headers: { authorization: 'Bearer valid-token' } });
      await requireAuth(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith();
    });
  });
});

// -----------------------------------------------------------------------------

describe('loadDbUser', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('returns 401 when req.user is not set', async () => {
    const req = buildReq({ user: null });
    await loadDbUser(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 })
    );
  });

  it('returns 401 when user row is not found (soft-deleted or missing)', async () => {
    // data: null means the .is('deleted_at', null) filter excluded the user
    supabaseAdmin.from.mockReturnValue({
      select:      jest.fn().mockReturnThis(),
      eq:          jest.fn().mockReturnThis(),
      is:          jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    const req = buildReq({ user: { id: 'user-deleted' } });
    await loadDbUser(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 })
    );
  });

  it('sets req.dbUser and calls next() when user row exists', async () => {
    const fakeUser = { id: 'user-1', email: 'seyi@example.com', full_name: 'Seyi' };
    supabaseAdmin.from.mockReturnValue({
      select:      jest.fn().mockReturnThis(),
      eq:          jest.fn().mockReturnThis(),
      is:          jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: fakeUser, error: null }),
    });
    const req = buildReq({ user: { id: 'user-1' } });
    await loadDbUser(req, buildRes(), next);
    expect(req.dbUser).toEqual(fakeUser);
    expect(next).toHaveBeenCalledWith();
  });
});
```

---

## `tests/middleware/workspace.test.js`

```javascript
// tests/middleware/workspace.test.js

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

const { requireMembership } = require('../../src/middleware/workspace');
const { supabaseAdmin }     = require('../../src/config/supabase');
const { buildReq, buildRes } = require('../helpers/mocks');

const WORKSPACE_ID = 'ws-test-1';
const USER_ID      = 'user-test-1';

const fakeMember = {
  id: 'member-1', role: 'member', display_name: 'Seyi',
  is_proxy: false, is_active: true, workspace_id: WORKSPACE_ID,
};
const fakeWorkspace = {
  id: WORKSPACE_ID, name: 'Test Family', base_currency: 'GBP',
  plan: 'free', visibility: 'private', bank_details: null,
};

// requireMembership makes two .from() calls: first workspace_members, then workspaces.
// We control each with mockReturnValueOnce.
function mockBothQueries({ member = null, memberErr = null, workspace = null, wsErr = null } = {}) {
  const makeChain = (result) => ({
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    is:          jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  });
  supabaseAdmin.from
    .mockReturnValueOnce(makeChain({ data: member,    error: memberErr }))  // 1st call
    .mockReturnValueOnce(makeChain({ data: workspace, error: wsErr }));     // 2nd call
}

// -----------------------------------------------------------------------------

describe('requireMembership', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('sets req.member and req.workspace then calls next() on success', async () => {
    mockBothQueries({ member: fakeMember, workspace: fakeWorkspace });
    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID },
      user:   { id: USER_ID },
    });
    await requireMembership(req, buildRes(), next);
    expect(req.member).toMatchObject({ id: 'member-1', role: 'member' });
    expect(req.workspace).toMatchObject({ id: WORKSPACE_ID, name: 'Test Family' });
    expect(next).toHaveBeenCalledWith();
  });

  it('maps snake_case display_name to camelCase displayName on req.member', async () => {
    mockBothQueries({ member: fakeMember, workspace: fakeWorkspace });
    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID },
      user:   { id: USER_ID },
    });
    await requireMembership(req, buildRes(), next);
    expect(req.member.displayName).toBe('Seyi');
    expect(req.member.display_name).toBeUndefined();
  });

  it('returns 404 (NOT 403) when user has no membership in workspace', async () => {
    // This is the enumeration-prevention behaviour — must stay 404
    mockBothQueries({ member: null });
    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID },
      user:   { id: USER_ID },
    });
    await requireMembership(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });

  it('does NOT return 403 — confirming enumeration protection is intact', async () => {
    mockBothQueries({ member: null });
    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID },
      user:   { id: USER_ID },
    });
    await requireMembership(req, buildRes(), next);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).not.toBe(403);
  });

  it('returns 404 when workspace itself is soft-deleted', async () => {
    // Member query succeeds, but workspace query returns null
    // (filtered out by .is('deleted_at', null))
    mockBothQueries({ member: fakeMember, workspace: null });
    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID },
      user:   { id: USER_ID },
    });
    await requireMembership(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });

  it('calls next(Error) when the member DB query returns a Supabase error', async () => {
    mockBothQueries({ memberErr: { message: 'DB connection failed' } });
    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID },
      user:   { id: USER_ID },
    });
    await requireMembership(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
```

---

## `tests/services/notification.test.js`

> **One small change needed first:** export `renderTemplate` and `buildDedupKey` from `notification.service.js`.
> At the bottom of that file, update:
> ```js
> module.exports = { send, renderTemplate, buildDedupKey };
> ```

```javascript
// tests/services/notification.test.js
const { renderTemplate, buildDedupKey } = require('../../src/services/notification.service');

// -----------------------------------------------------------------------------

describe('renderTemplate', () => {
  it('replaces a single placeholder', () => {
    expect(renderTemplate('Hello {name}', { name: 'Seyi' }))
      .toBe('Hello Seyi');
  });

  it('replaces multiple different placeholders', () => {
    expect(renderTemplate(
      '{actor} submitted {amount} for {container}',
      { actor: 'Seyi', amount: '500 GBP', container: 'Christmas Fund' }
    )).toBe('Seyi submitted 500 GBP for Christmas Fund');
  });

  it('replaces ALL occurrences of the same placeholder (replaceAll)', () => {
    expect(renderTemplate('{name} says {name}', { name: 'Seyi' }))
      .toBe('Seyi says Seyi');
  });

  it('replaces a missing variable with empty string — does not crash', () => {
    expect(renderTemplate('Hello {name}', {})).toBe('Hello ');
  });

  it('replaces null value with empty string', () => {
    expect(renderTemplate('Amount: {amount}', { amount: null })).toBe('Amount: ');
  });

  it('replaces undefined value with empty string', () => {
    expect(renderTemplate('Amount: {amount}', { amount: undefined })).toBe('Amount: ');
  });

  it('converts number values to strings', () => {
    expect(renderTemplate('{count} overdue', { count: 5 })).toBe('5 overdue');
  });

  it('leaves template unchanged when no placeholders present', () => {
    expect(renderTemplate('No placeholders here', {})).toBe('No placeholders here');
  });

  it('ignores extra variables that are not in the template', () => {
    expect(renderTemplate('Hi {name}', { name: 'Seyi', extra: 'ignored' }))
      .toBe('Hi Seyi');
  });

  // Real templates from your TEMPLATES registry
  it('renders payment_reminder body correctly', () => {
    expect(renderTemplate(
      'Reminder: {amount} for {container} due {due_date}',
      { amount: '200 GBP', container: 'Christmas', due_date: '2025-12-01' }
    )).toBe('Reminder: 200 GBP for Christmas due 2025-12-01');
  });

  it('renders overdue_summary_admin body correctly', () => {
    expect(renderTemplate(
      '{count} contributors overdue in {container}',
      { count: 3, container: 'Wedding Fund' }
    )).toBe('3 contributors overdue in Wedding Fund');
  });
});

// -----------------------------------------------------------------------------

describe('buildDedupKey', () => {
  it('returns just the type when no optional fields present', () => {
    expect(buildDedupKey('task_assigned', {})).toBe('task_assigned');
  });

  it('includes participant_id when present', () => {
    expect(buildDedupKey('payment_reminder', { participant_id: 'p-1' }))
      .toBe('payment_reminder:p-1');
  });

  it('includes container_id when present', () => {
    expect(buildDedupKey('payment_reminder', { container_id: 'c-1' }))
      .toBe('payment_reminder:c-1');
  });

  it('includes due_date when present', () => {
    expect(buildDedupKey('payment_reminder', { due_date: '2025-12-01' }))
      .toBe('payment_reminder:2025-12-01');
  });

  it('appends "d" suffix to days field', () => {
    expect(buildDedupKey('payment_reminder', { days: 3 }))
      .toBe('payment_reminder:3d');
  });

  it('includes cycle_id when present', () => {
    expect(buildDedupKey('cycle_started', { cycle_id: 'cy-1' }))
      .toBe('cycle_started:cy-1');
  });

  it('builds full key with all fields in correct order', () => {
    const key = buildDedupKey('payment_reminder', {
      participant_id: 'p-1',
      container_id:   'c-1',
      due_date:       '2025-12-01',
      days:           3,
    });
    expect(key).toBe('payment_reminder:p-1:c-1:2025-12-01:3d');
  });
});
```

---

## `tests/services/audit.test.js`

```javascript
// tests/services/audit.test.js

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

const audit        = require('../../src/services/audit.service');
const { supabaseAdmin } = require('../../src/config/supabase');
const { buildReq } = require('../helpers/mocks');

// -----------------------------------------------------------------------------

describe('audit.fromReq — pure extraction helper', () => {
  it('extracts workspaceId from req.member', () => {
    const req = buildReq({
      member: { workspaceId: 'ws-1', id: 'mem-1' },
      user:   { id: 'user-1' },
    });
    expect(audit.fromReq(req).workspaceId).toBe('ws-1');
  });

  it('extracts actorMemberId from req.member.id', () => {
    const req = buildReq({
      member: { workspaceId: 'ws-1', id: 'mem-1' },
      user:   { id: 'user-1' },
    });
    expect(audit.fromReq(req).actorMemberId).toBe('mem-1');
  });

  it('extracts actorUserId from req.user.id', () => {
    const req = buildReq({
      member: { workspaceId: 'ws-1', id: 'mem-1' },
      user:   { id: 'user-1' },
    });
    expect(audit.fromReq(req).actorUserId).toBe('user-1');
  });

  it('extracts ipAddress from req.ip', () => {
    const req = buildReq({
      member: { workspaceId: 'ws-1', id: 'mem-1' },
      user:   { id: 'user-1' },
      ip:     '192.168.1.1',
    });
    expect(audit.fromReq(req).ipAddress).toBe('192.168.1.1');
  });

  it('extracts userAgent from req.headers["user-agent"]', () => {
    const req = buildReq({
      member:  { workspaceId: 'ws-1', id: 'mem-1' },
      user:    { id: 'user-1' },
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    expect(audit.fromReq(req).userAgent).toBe('Mozilla/5.0');
  });

  it('returns null workspaceId when req.member is absent', () => {
    const req = buildReq({ member: null, user: { id: 'user-1' } });
    expect(audit.fromReq(req).workspaceId).toBeNull();
  });

  it('returns null actorMemberId when req.member is absent', () => {
    const req = buildReq({ member: null, user: { id: 'user-1' } });
    expect(audit.fromReq(req).actorMemberId).toBeNull();
  });

  it('returns null actorUserId when req.user is absent', () => {
    const req = buildReq({ member: { workspaceId: 'ws-1', id: 'mem-1' }, user: null });
    expect(audit.fromReq(req).actorUserId).toBeNull();
  });
});

// -----------------------------------------------------------------------------

describe('audit.log — fire-and-forget contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('never throws when Supabase insert returns an error', async () => {
    supabaseAdmin.from.mockReturnValue({
      insert: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB down' } }),
    });
    await expect(
      audit.log({ action: 'test.action', workspaceId: 'ws-1' })
    ).resolves.not.toThrow();
  });

  it('never throws when Supabase itself throws a network error', async () => {
    supabaseAdmin.from.mockReturnValue({
      insert: jest.fn().mockRejectedValue(new Error('Network timeout')),
    });
    await expect(
      audit.log({ action: 'test.action' })
    ).resolves.not.toThrow();
  });

  it('writes to the "audit_log" table', async () => {
    supabaseAdmin.from.mockReturnValue({
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    await audit.log({ action: 'workspace.deleted', workspaceId: 'ws-1' });
    expect(supabaseAdmin.from).toHaveBeenCalledWith('audit_log');
  });
});
```

---

## `tests/workers/reminder.test.js`

This file tests the date math logic in isolation — no BullMQ, no Supabase.

> **Recommended refactor:** Extract the date logic from `background.workers.js` into  
> `src/utils/dates.js` so it can be tested directly:
> ```js
> // src/utils/dates.js
> function getDaysUntil(dueDateStr, scanDateStr) {
>   const dueDate = new Date(dueDateStr);
>   const today   = new Date(scanDateStr);
>   return Math.ceil((dueDate - today) / 86400000);
> }
> module.exports = { getDaysUntil };
> ```
> Until you do that, the inline copy below lets you test the logic now.

```javascript
// tests/workers/reminder.test.js

// Inline copy of the logic from background.workers.js
// Replace with: const { getDaysUntil } = require('../../src/utils/dates');
// once you extract it.
function getDaysUntil(dueDateStr, scanDateStr) {
  const dueDate = new Date(dueDateStr);
  const today   = new Date(scanDateStr);
  return Math.ceil((dueDate - today) / 86400000);
}

// -----------------------------------------------------------------------------

describe('getDaysUntil — core date calculation', () => {
  it('returns 3 when due date is 3 days away', () => {
    expect(getDaysUntil('2025-01-04', '2025-01-01')).toBe(3);
  });

  it('returns 1 when due date is tomorrow', () => {
    expect(getDaysUntil('2025-01-02', '2025-01-01')).toBe(1);
  });

  it('returns 0 on the due date itself', () => {
    expect(getDaysUntil('2025-01-01', '2025-01-01')).toBe(0);
  });

  it('returns -1 one day after due date (first day overdue)', () => {
    expect(getDaysUntil('2025-01-01', '2025-01-02')).toBe(-1);
  });

  it('returns -7 one week after due date', () => {
    expect(getDaysUntil('2025-01-01', '2025-01-08')).toBe(-7);
  });

  it('daysOverdue is the positive inverse of daysUntil when past due', () => {
    const daysUntil   = getDaysUntil('2025-01-01', '2025-01-04'); // -3
    const daysOverdue = -daysUntil;
    expect(daysOverdue).toBe(3);
  });
});

// -----------------------------------------------------------------------------

describe('reminder trigger logic', () => {
  const reminderDays = [3, 1]; // your default from background.workers.js
  const overdueDays  = [3, 7]; // your default from background.workers.js

  it('triggers a reminder when daysUntil is 3', () => {
    const daysUntil = getDaysUntil('2025-01-04', '2025-01-01');
    expect(daysUntil >= 0 && reminderDays.includes(daysUntil)).toBe(true);
  });

  it('triggers a reminder when daysUntil is 1', () => {
    const daysUntil = getDaysUntil('2025-01-02', '2025-01-01');
    expect(daysUntil >= 0 && reminderDays.includes(daysUntil)).toBe(true);
  });

  it('does NOT trigger a reminder when daysUntil is 2 (not in reminderDays)', () => {
    const daysUntil = getDaysUntil('2025-01-03', '2025-01-01');
    expect(daysUntil >= 0 && reminderDays.includes(daysUntil)).toBe(false);
  });

  it('triggers an overdue notification when daysOverdue is 3', () => {
    const daysUntil   = getDaysUntil('2025-01-01', '2025-01-04');
    const daysOverdue = -daysUntil;
    expect(daysUntil < 0 && overdueDays.includes(daysOverdue)).toBe(true);
  });

  it('triggers an overdue notification when daysOverdue is 7', () => {
    const daysUntil   = getDaysUntil('2025-01-01', '2025-01-08');
    const daysOverdue = -daysUntil;
    expect(daysUntil < 0 && overdueDays.includes(daysOverdue)).toBe(true);
  });

  it('does NOT trigger overdue when daysOverdue is 1 (not in overdueDays)', () => {
    const daysUntil   = getDaysUntil('2025-01-01', '2025-01-02');
    const daysOverdue = -daysUntil;
    expect(daysUntil < 0 && overdueDays.includes(daysOverdue)).toBe(false);
  });

  it('triggers neither reminder nor overdue when due today (daysUntil=0)', () => {
    // NOTE: daysUntil=0 is a silent gap. Today is neither upcoming (>0)
    // nor overdue (<0). You may want to add 0 to reminderDays to cover this.
    const daysUntil   = getDaysUntil('2025-01-01', '2025-01-01');
    const daysOverdue = -daysUntil;
    expect(daysUntil >= 0 && reminderDays.includes(daysUntil)).toBe(false);
    expect(daysUntil < 0  && overdueDays.includes(daysOverdue)).toBe(false);
  });
});
```

---

## `tests/controllers/ledger.test.js`

```javascript
// tests/controllers/ledger.test.js

jest.mock('../../src/config/supabase',               () => ({ supabaseAdmin: { from: jest.fn() } }));
jest.mock('../../src/services/notification.service', () => ({ send: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/services/audit.service',        () => ({
  log:     jest.fn().mockResolvedValue(undefined),
  fromReq: jest.fn().mockReturnValue({}),
}));
jest.mock('../../src/services/storage.service', () => ({
  generateUploadUrl:   jest.fn(),
  generateDownloadUrl: jest.fn(),
}));
jest.mock('../../src/services/export.service', () => ({
  exportLedgerCSV: jest.fn(),
}));

const { createEntry } = require('../../src/controllers/ledger.controller');
const { supabaseAdmin } = require('../../src/config/supabase');
const { buildReq, buildRes, buildMember } = require('../helpers/mocks');

// Build a chainable mock that resolves to `result` at .single() / .maybeSingle()
function mockChain(result) {
  return {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    is:          jest.fn().mockReturnThis(),
    gte:         jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(result),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

const WORKSPACE_ID = 'ws-1';
const CONTAINER_ID = 'container-1';
const CALLER_ID    = 'member-1';

const validBody = {
  contributor_id:    CALLER_ID,
  entry_type:        'contribution',
  original_amount:   100,
  original_currency: 'GBP',
  base_amount:       100,
  is_crypto:         false,
};

// -----------------------------------------------------------------------------

describe('createEntry — access control', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('returns 403 when non-admin submits for a different contributor', async () => {
    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID, containerId: CONTAINER_ID },
      query:  {},
      body:   { ...validBody, contributor_id: 'member-99' }, // not the caller
      member: buildMember({ role: 'member', id: CALLER_ID }),
    });
    await createEntry(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('allows admin to submit on behalf of a different contributor', async () => {
    supabaseAdmin.from
      .mockReturnValueOnce(mockChain({ data: { id: 'part-1', workspace_members: { is_proxy: false } }, error: null })) // participant check
      .mockReturnValueOnce(mockChain({ data: { id: 'entry-1', status: 'confirmed' }, error: null })); // insert

    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID, containerId: CONTAINER_ID },
      query:  { force: 'true' },
      body:   { ...validBody, contributor_id: 'member-99' },
      member: buildMember({ role: 'admin', id: CALLER_ID }),
    });
    await createEntry(req, buildRes(), next);
    expect(next).not.toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});

// -----------------------------------------------------------------------------

describe('createEntry — business rules', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('returns 422 when contributor is not a participant in the container', async () => {
    supabaseAdmin.from.mockReturnValueOnce(
      mockChain({ data: null, error: null }) // participant not found
    );
    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID, containerId: CONTAINER_ID },
      query:  {},
      body:   validBody,
      member: buildMember({ role: 'member', id: CALLER_ID }),
    });
    await createEntry(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 422 })
    );
  });

  it('returns 409 when a duplicate entry is detected within 10 minutes', async () => {
    supabaseAdmin.from
      .mockReturnValueOnce(mockChain({ data: { id: 'part-1', workspace_members: { is_proxy: false } }, error: null })) // participant
      .mockReturnValueOnce(mockChain({ data: { id: 'dup-entry' }, error: null })); // duplicate found

    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID, containerId: CONTAINER_ID },
      query:  {}, // no force=true
      body:   validBody,
      member: buildMember({ role: 'member', id: CALLER_ID }),
    });
    await createEntry(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 })
    );
  });

  it('bypasses duplicate check when ?force=true is set', async () => {
    supabaseAdmin.from
      .mockReturnValueOnce(mockChain({ data: { id: 'part-1', workspace_members: { is_proxy: false } }, error: null })) // participant
      .mockReturnValueOnce(mockChain({ data: { id: 'entry-1', status: 'pending' }, error: null })); // insert

    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID, containerId: CONTAINER_ID },
      query:  { force: 'true' },
      body:   validBody,
      member: buildMember({ role: 'member', id: CALLER_ID }),
    });
    await createEntry(req, buildRes(), next);
    expect(next).not.toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 })
    );
  });

  it('auto-confirms entry when admin creates it', async () => {
    let captured = null;
    supabaseAdmin.from
      .mockReturnValueOnce(mockChain({ data: { id: 'part-1', workspace_members: { is_proxy: false } }, error: null })) // participant
      .mockReturnValueOnce({
        // intercept the insert call to capture its argument
        insert: jest.fn().mockImplementation((data) => {
          captured = data;
          return {
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: { id: 'entry-1', ...data }, error: null }),
          };
        }),
      });

    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID, containerId: CONTAINER_ID },
      query:  { force: 'true' },
      body:   validBody,
      member: buildMember({ role: 'admin', id: CALLER_ID }),
    });
    await createEntry(req, buildRes(), next);
    expect(captured?.status).toBe('confirmed');
  });

  it('sets entry to "pending" when regular member creates it', async () => {
    let captured = null;
    supabaseAdmin.from
      .mockReturnValueOnce(mockChain({ data: { id: 'part-1', workspace_members: { is_proxy: false } }, error: null })) // participant
      .mockReturnValueOnce(mockChain({ data: null, error: null }))  // no duplicate
      .mockReturnValueOnce({
        insert: jest.fn().mockImplementation((data) => {
          captured = data;
          return {
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: { id: 'entry-1', ...data }, error: null }),
          };
        }),
      });

    const req = buildReq({
      params: { workspaceId: WORKSPACE_ID, containerId: CONTAINER_ID },
      query:  {},
      body:   validBody,
      member: buildMember({ role: 'member', id: CALLER_ID }),
    });
    await createEntry(req, buildRes(), next);
    expect(captured?.status).toBe('pending');
  });
});
```

---

## `tests/controllers/dispute.test.js`

```javascript
// tests/controllers/dispute.test.js

jest.mock('../../src/config/supabase',               () => ({ supabaseAdmin: { from: jest.fn() } }));
jest.mock('../../src/services/notification.service', () => ({ send: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/services/audit.service',        () => ({
  log:     jest.fn().mockResolvedValue(undefined),
  fromReq: jest.fn().mockReturnValue({}),
}));

const { raiseDispute, resolveDispute, addDisputeNote } = require('../../src/controllers/dispute.controller');
const { supabaseAdmin } = require('../../src/config/supabase');
const { buildReq, buildRes, buildMember } = require('../helpers/mocks');

function mockChain(result) {
  return {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(result),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

// -----------------------------------------------------------------------------

describe('raiseDispute', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('returns 404 when ledger entry does not exist', async () => {
    supabaseAdmin.from.mockReturnValueOnce(
      mockChain({ data: null, error: null })
    );
    const req = buildReq({
      params: { workspaceId: 'ws-1', containerId: 'c-1', entryId: 'ghost' },
      body:   { reason: 'Not mine' },
      member: buildMember({ role: 'member', id: 'member-1' }),
    });
    await raiseDispute(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('returns 403 when non-admin tries to dispute someone else\'s entry', async () => {
    supabaseAdmin.from.mockReturnValueOnce(
      mockChain({ data: { id: 'entry-1', contributor_id: 'member-99', status: 'confirmed' }, error: null })
    );
    const req = buildReq({
      params: { workspaceId: 'ws-1', containerId: 'c-1', entryId: 'entry-1' },
      body:   { reason: 'Not mine' },
      member: buildMember({ role: 'member', id: 'member-1' }), // not member-99
    });
    await raiseDispute(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('returns 422 when entry status is "resolved" (invalid to dispute)', async () => {
    supabaseAdmin.from.mockReturnValueOnce(
      mockChain({ data: { id: 'entry-1', contributor_id: 'member-1', status: 'resolved' }, error: null })
    );
    const req = buildReq({
      params: { workspaceId: 'ws-1', containerId: 'c-1', entryId: 'entry-1' },
      body:   { reason: 'Test' },
      member: buildMember({ role: 'member', id: 'member-1' }),
    });
    await raiseDispute(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  it('returns 422 when entry is already disputed', async () => {
    supabaseAdmin.from.mockReturnValueOnce(
      mockChain({ data: { id: 'entry-1', contributor_id: 'member-1', status: 'disputed' }, error: null })
    );
    const req = buildReq({
      params: { workspaceId: 'ws-1', containerId: 'c-1', entryId: 'entry-1' },
      body:   { reason: 'Again' },
      member: buildMember({ role: 'member', id: 'member-1' }),
    });
    await raiseDispute(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });
});

// -----------------------------------------------------------------------------

describe('resolveDispute', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('returns 404 when dispute does not exist', async () => {
    supabaseAdmin.from.mockReturnValueOnce(
      mockChain({ data: null, error: null })
    );
    const req = buildReq({
      params: { workspaceId: 'ws-1', disputeId: 'ghost' },
      body:   { resolution_note: 'Done' },
      member: buildMember({ role: 'admin' }),
    });
    await resolveDispute(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('returns 422 when dispute is already resolved', async () => {
    supabaseAdmin.from.mockReturnValueOnce(
      mockChain({ data: { id: 'd-1', status: 'resolved', ledger_entry_id: 'e-1' }, error: null })
    );
    const req = buildReq({
      params: { workspaceId: 'ws-1', disputeId: 'd-1' },
      body:   { resolution_note: 'Already done' },
      member: buildMember({ role: 'admin' }),
    });
    await resolveDispute(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });
});

// -----------------------------------------------------------------------------

describe('addDisputeNote', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('returns 403 when non-admin adds note to someone else\'s dispute', async () => {
    supabaseAdmin.from.mockReturnValueOnce(
      mockChain({ data: { id: 'd-1', raised_by: 'member-99', notes: [] }, error: null })
    );
    const req = buildReq({
      params: { workspaceId: 'ws-1', disputeId: 'd-1' },
      body:   { note: 'My note' },
      member: buildMember({ role: 'member', id: 'member-1' }), // not member-99
    });
    await addDisputeNote(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('allows the dispute owner to add a note to their own dispute', async () => {
    supabaseAdmin.from
      .mockReturnValueOnce(mockChain({ data: { id: 'd-1', raised_by: 'member-1', notes: [] }, error: null }))
      .mockReturnValueOnce(mockChain({ data: { id: 'd-1', notes: [{ note: 'My note' }] }, error: null }));

    const req = buildReq({
      params: { workspaceId: 'ws-1', disputeId: 'd-1' },
      body:   { note: 'My note' },
      member: buildMember({ role: 'member', id: 'member-1' }),
    });
    await addDisputeNote(req, buildRes(), next);
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });

  it('allows admin to add a note to any dispute', async () => {
    supabaseAdmin.from
      .mockReturnValueOnce(mockChain({ data: { id: 'd-1', raised_by: 'member-99', notes: [] }, error: null }))
      .mockReturnValueOnce(mockChain({ data: { id: 'd-1', notes: [{ note: 'Admin note' }] }, error: null }));

    const req = buildReq({
      params: { workspaceId: 'ws-1', disputeId: 'd-1' },
      body:   { note: 'Admin note' },
      member: buildMember({ role: 'admin', id: 'admin-1' }),
    });
    await addDisputeNote(req, buildRes(), next);
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });
});
```

---

## Running Your Tests

```bash
# Run all tests once
npm test

# Watch mode — reruns on every file save
npm run test:watch

# Run a single file
npx jest tests/middleware/role.test.js

# Run only tests matching a name pattern
npx jest --testNamePattern="requireAdmin"

# See coverage report
npm run test:coverage
```

### Expected first run output

```
PASS tests/middleware/role.test.js
  requireAdmin
    ✓ calls next() with no args when member is admin
    ✓ calls next(ForbiddenError 403) when role is "member"
    ✓ calls next(ForbiddenError 403) when req.member is null
    ✓ calls next(ForbiddenError 403) when req.member is undefined
    ✓ error message says "Admin access required"
  requireSelfOrAdmin
    admin caller
      ✓ allows admin to access their own resource
      ✓ allows admin to access any other member resource
    regular member caller
      ✓ allows member to access their own resource
      ✓ blocks member from accessing another member resource
      ✓ uses a custom getMemberId function when provided

Tests: 10 passed, 10 total
```

If a test is red, read the error message carefully. It tells you exactly what your code returned vs what the test expected. That mismatch is the information — either your code has a bug, or your understanding of the expected behaviour needs updating. Both outcomes are useful.
